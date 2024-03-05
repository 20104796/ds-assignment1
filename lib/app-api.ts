import { Aws } from "aws-cdk-lib";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apig from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as node from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as custom from "aws-cdk-lib/custom-resources";
import { generateBatch } from '../shared/util';
import { reviews } from '../seed/reviews';
import * as lambdanode from 'aws-cdk-lib/aws-lambda-nodejs';

type AppApiProps = {
    userPoolId: string;
    userPoolClientId: string;
};

export class AppApi extends Construct {
    constructor(scope: Construct, id: string, props: AppApiProps) {
        super(scope, id);

        //DynamoDB table
        const reviewsTable = new dynamodb.Table(this, "reviewsTable", {
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            partitionKey: { name: "MovieId", type: dynamodb.AttributeType.NUMBER },
            sortKey: { name: "ReviewerName", type: dynamodb.AttributeType.STRING },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            tableName: "Reviews",
        });


        //table seeding
        new custom.AwsCustomResource(this, "reviewsddbInitData", {
            onCreate: {
                service: "DynamoDB",
                action: "batchWriteItem",
                parameters: {
                    RequestItems: {
                        [reviewsTable.tableName]: generateBatch(reviews)
                    },
                },
                physicalResourceId: custom.PhysicalResourceId.of("reviewsddbInitData"),
            },
            policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
                resources: [reviewsTable.tableArn]
            }),
        });


        //Lab Code
        //Authorization
        const appCommonFnProps = {
            architecture: lambda.Architecture.ARM_64,
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,
            runtime: lambda.Runtime.NODEJS_16_X,
            handler: "handler",
            environment: {
                USER_POOL_ID: props.userPoolId,
                CLIENT_ID: props.userPoolClientId,
                REGION: cdk.Aws.REGION,
            },
        };

        const authorizerFn = new node.NodejsFunction(this, "AuthorizerFn", {
            ...appCommonFnProps,
            entry: "./lambda/auth/authorizer.ts",
        });

        const requestAuthorizer = new apig.RequestAuthorizer(
            this,
            "RequestAuthorizer",
            {
                identitySources: [apig.IdentitySource.header("cookie")],
                handler: authorizerFn,
                resultsCacheTtl: cdk.Duration.minutes(0),
            }
        );
        //Authorization

        const getMovieReviewsFn = new lambdanode.NodejsFunction(
            this,
            "GetMovieReviewsFn",
            {
                architecture: lambda.Architecture.ARM_64,
                runtime: lambda.Runtime.NODEJS_16_X,
                entry: `${__dirname}/../lambda/getMovieReviews.ts`,
                timeout: cdk.Duration.seconds(10),
                memorySize: 128,
                environment: {
                    TABLE_NAME: reviewsTable.tableName,
                    REGION: 'eu-west-1',
                },
            }
        )
        reviewsTable.grantReadData(getMovieReviewsFn)


        const getAllReviewsByAuthorFn = new lambdanode.NodejsFunction(this, "GetAllReviewsByAuthorFn", {
            architecture: lambda.Architecture.ARM_64,
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: `${__dirname}/../lambda/getAllReviewsByAuthor.ts`,
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,
            environment: {
                TABLE_NAME: reviewsTable.tableName,
                REGION: "eu-west-1",
            },
        });
        reviewsTable.grantReadData(getAllReviewsByAuthorFn)



        /** 不适用了 reviewerName 和 year 不能同时设置
        const getMovieReviewsByAuthorFn = new lambdanode.NodejsFunction(this, "GetMovieReviewsByAuthorFn", {
            architecture: lambda.Architecture.ARM_64,
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: `${__dirname}/../lambda/getMovieReviewsByAuthor.ts`,
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,
            environment: {
                TABLE_NAME: reviewsTable.tableName,
                REGION: "eu-west-1",
            },
        });
        reviewsTable.grantReadData(getMovieReviewsByAuthorFn)

        const getMovieReviewsByYearFn = new lambdanode.NodejsFunction(this, "GetMovieReviewsByYearFn", {
            architecture: lambda.Architecture.ARM_64,
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: `${__dirname}/../lambda/getMovieReviewsByYear.ts`,
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,
            environment: {
                TABLE_NAME: reviewsTable.tableName,
                REGION: "eu-west-1",
            },
        });
        reviewsTable.grantReadData(getMovieReviewsByYearFn)

         */

        const getMovieReviewsByAuthorOrYearFn = new lambdanode.NodejsFunction(this, "GetMovieReviewsByAuthorOrYearFn", {
            architecture: lambda.Architecture.ARM_64,
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: `${__dirname}/../lambda/getMovieReviewsByAuthorOrYear.ts`,
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,
            environment: {
                TABLE_NAME: reviewsTable.tableName,
                REGION: "eu-west-1",
            },
        });
        reviewsTable.grantReadData(getMovieReviewsByAuthorOrYearFn)


        //add review
        const newReviewFn = new lambdanode.NodejsFunction(this, "AddReviewFn", {
            architecture: lambda.Architecture.ARM_64,
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: `${__dirname}/../lambda/addReview.ts`,
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,
            environment: {
                TABLE_NAME: reviewsTable.tableName,
                REGION: "eu-west-1",
            },
        });
        reviewsTable.grantReadWriteData(newReviewFn)


        //REST API
        const api = new apig.RestApi(this, "RestAPI", {
                description: "Assignment 1 API",
                deployOptions: {
                    stageName: "dev",
                },
                //CORS
                defaultCorsPreflightOptions: {
                    allowHeaders: ["Content-Type", "X-Amz-Date"],
                    allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
                    allowCredentials: true,
                    allowOrigins: ["*"],
                },
            }
        )

        const moviesEndpoint = api.root.addResource("movies");

        const reviewsEndpoint = moviesEndpoint.addResource("reviews")
        reviewsEndpoint.addMethod(
            "POST",
            new apig.LambdaIntegration(newReviewFn, { proxy: true }),
            {
                authorizer: requestAuthorizer,
                authorizationType: apig.AuthorizationType.CUSTOM,
            }
        )

        const movieIdEndpoint = moviesEndpoint.addResource("{movieId}");
        const movieReviewsEndpoint = movieIdEndpoint.addResource("reviews");
        /**
        movieReviewsEndpoint.addMethod(
            "GET",
            new apig.LambdaIntegration(getMovieReviewsFn, { proxy: true })
        )


        const movieReviewsByAuthorOrYearEndpoint = movieReviewsEndpoint.addResource("{inputPara}");
        movieReviewsByAuthorOrYearEndpoint.addMethod(
            "GET",
            new apig.LambdaIntegration(getMovieReviewsByAuthorOrYearFn, { proxy: true })
        )
         */

        /** specific endpoints for reviews
        const reviewsEndpoint = api.root.addRvesource("reviews");
        const getAllReviewsByAuthorEndpoint = reviewsEndpoint.addResource("{reviewerName}")
        getAllReviewsByAuthorEndpoint.addMethod(
            "GET",
            new apig.LambdaIntegration(getAllReviewsByAuthorFn, { proxy: true })
        )
        */




        //Lab
        /**

        const protectedFn = new node.NodejsFunction(this, "ProtectedFn", {
            ...appCommonFnProps,
            entry: "./lambda/protected.ts",
        });

        const publicFn = new node.NodejsFunction(this, "PublicFn", {
            ...appCommonFnProps,
            entry: "./lambda/public.ts",
        });


        */

    }
}
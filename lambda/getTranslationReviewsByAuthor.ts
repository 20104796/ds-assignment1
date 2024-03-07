import { APIGatewayProxyHandler } from 'aws-lambda';
import 'source-map-support/register';
import * as AWS from 'aws-sdk';
import {DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {DynamoDBClient} from "@aws-sdk/client-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: APIGatewayProxyHandler = async (event,context) => {

    //define response
    const apiResponses = {
        _200: (body: { [key: string]: any }) => {
            return {
                statusCode: 200,
                body: JSON.stringify(body, null, 2),
            };
        },
        _400: (body: { [key: string]: any }) => {
            return {
                statusCode: 400,
                body: JSON.stringify(body, null, 2),
            };
        },
    };

    //get parameter
    // /reviews/{reviewerName}/{movieId}/translation?language=code

    console.log("Event: ", event);
    const parameters = event?.pathParameters;
    const reviewerName = parameters?.reviewerName ? parameters.reviewerName : undefined;
    const movieId = parameters?.movieId ? parseInt(parameters.movieId) : undefined;
    const language = event?.queryStringParameters?.language ? event?.queryStringParameters?.language : undefined;


    if (!reviewerName) {
        return apiResponses._400({ message: 'Missing reviewerName.' });
    }
    if (!movieId ) {
        return apiResponses._400({ message: 'Missing movieId.' });
    }
    if (!language) {
        return apiResponses._400({ message: 'Missing language.' });
    }

    const commandOutput = await ddbDocClient.send(
        new QueryCommand({
            TableName: process.env.TABLE_NAME,
            KeyConditionExpression: "MovieId = :movieId AND ReviewerName = :reviewerName",
            ExpressionAttributeValues: {
                ":movieId": movieId,
                ":reviewerName": reviewerName
            },
        })
    );

    let text;
    if (commandOutput.Items && commandOutput.Items.length > 0) {
        text = commandOutput.Items[0].Content;
    }else {
        console.log("No reviews found.");
        return apiResponses._400({ message: 'No reviews found.' });
    }

    if (!text) {
        return apiResponses._400({ message: 'Missing text.' });
    }



    //start translation
    const translate = new AWS.Translate();
    try {
        const translateParams: AWS.Translate.Types.TranslateTextRequest = {
            Text: text,
            SourceLanguageCode: 'en',
            TargetLanguageCode: language,
        };
        const translatedMessage = await translate.translateText(translateParams).promise();
        return apiResponses._200({ translatedMessage });
    } catch (error) {
        console.log('error in the translation', error);
        return apiResponses._400({ message: 'unable to translate the message' });
    }
};


function createDDbDocClient() {
    const ddbClient = new DynamoDBClient({ region: process.env.REGION });
    const marshallOptions = {
        convertEmptyValues: true,
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
    };
    const unmarshallOptions = {
        wrapNumbers: false,
    };
    const translateConfig = { marshallOptions, unmarshallOptions };
    return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}

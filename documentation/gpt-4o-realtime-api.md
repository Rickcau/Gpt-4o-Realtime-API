# Gpt-40-Realtime-API
This API is in preview and is only suuitable for **testing and development** which means there could be some latency or throttling.  

## Limitations
***IMPORTANT:*** The system stores your prompts and completions as described in the `Data Use and Access for Abuse Monitoring` section of the service-specific Product Terms for Azure OpenAI Service, except that the Limited Exception does not apply. Abuse monitoring will be turned on for use of the GPT-4o-realtime-preview API even for customers who otherwise are approved for modified abuse monitoring.

Currently, the **gpt-4o-realtime-preview model** focuses on `text and audio` and **does not support existing gpt-4o features such as image modality and structured outputs**.  ***For many tasks, the generally available gpt-4o models may still be more suitable.*

***IMPORTANT:*** At this time, gpt-4o-realtime-preview usage limits are suitable for **test and development**. To prevent abuse and preserve service integrity, rate limits will be adjusted as needed.

## Important Notes
The Realtime API is built on WebSockets and as such many of the existing libraries do not have support for it yet, i.e. Azure.AI.OpenAI library. It is also in preview so how you interact with the API could change.  

Based on the currently preview this means our code would need to establish a WebSocket connection manually.  

### Basic steps needed to interact with the Realtime API.

1. Create a WebSocket conneciton to the Azure OpenAI endpoint with the correct URL, including the deployment name and API verison.
    - WebSocket URI would look something like this
    ```
        Wss://{resource-endpoint}/openai/realtime?api-version=2024-12-17&deployment=gpt-40-realtime-preview&api-key=KEY
    ```
    You would connect using `ClientWebSocket`.

2. Authenticate using the API key in the headers.
    - Send and receive messages in the formated expected by the Realtime API, handling events like session creation, conversation itesm and responses

3. Handle WebSocket communcation in C# requires asynchronous programming.  Code should use ClientWebSocket from System.Net.WebSockets.
   App needs to send and receive JSON events as per the Realtime API's specifications. For example, sending a `concersation.item.create' event with the user's message.

4. Listen for responses from the model and display them.

## Key Components of the implementation
1. WebSocket Connection:

    - Uses ClientWebSocket for real-time communication

    - Includes API version and deployment parameters in connection URL

    - Handles secure WebSocket (wss) connection

2. Message Handling:

    - Implements separate tasks for sending and receiving messages

    - Uses JSON format for API communication

    - Includes basic conversation item creation structure

3. Configuration Requirements:

    - Replace placeholder values with your Azure OpenAI details

    - Requires System.Net.WebSockets.Client NuGet package

    - .NET 9+ recommended for WebSocket support
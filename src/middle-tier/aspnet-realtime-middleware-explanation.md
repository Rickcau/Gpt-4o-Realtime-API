# ASP.NET Core Realtime Middleware Controller Explanation

This document explains how the `RealtimeMiddleTierController` works, including its communication patterns with WebSocket clients and the OpenAI Realtime API service.

## Overview

The `RealtimeMiddleTierController` acts as a middleware that:

1. Accepts WebSocket connections from clients
2. Establishes a connection to the OpenAI Realtime API service
3. Passes messages between clients and the service
4. Handles both text and audio data transmission

## Architecture

The controller establishes two main communication channels:

```
Client <--WebSocket--> RealtimeMiddleTierController <--RealtimeConversationSession--> OpenAI Service
```

## Key Components

### Controller Initialization
- The controller requires configuration settings for OpenAI or Azure OpenAI
- Logging is used extensively to trace operation flow

### WebSocket Connection Handling
- Accepts incoming WebSocket connections at the `/realtime` endpoint
- Maintains a single WebSocket connection per controller instance

### Service Session Management
- Creates and configures a `RealtimeConversationSession` with either:
  - Azure OpenAI (if `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT` are provided)
  - OpenAI (if `OPENAI_API_KEY` is provided)
- Configures transcription options using Whisper model

## Communication Flow

### Client to Service Flow
1. Client connects to the WebSocket endpoint `/realtime`
2. Controller accepts the connection and establishes a session with the OpenAI service
3. Client sends either:
   - Text messages (JSON formatted `ClientReceivableUserMessage`)
   - Binary audio data
4. Controller forwards these messages to the OpenAI service

### Service to Client Flow
1. Service sends updates via the `RealtimeConversationSession`
2. Controller processes various update types:
   - `ConversationInputSpeechStartedUpdate` - speech input started
   - `ConversationItemStreamingPartDeltaUpdate` - streaming content (text or audio)
   - `ConversationInputTranscriptionFinishedUpdate` - transcription completed
3. Controller forwards appropriate messages back to the client

## Message Types

### From Client to Controller
- Text messages (JSON format):
  ```json
  {
    "type": "user_message",
    "text": "Your message text here"
  }
  ```
- Binary audio data (sent directly as binary WebSocket messages)

### From Controller to Client
- Connected message (sent when client connects)
- Speech started message
- Text delta message (streaming text responses)
- Audio data (binary format)
- Transcription message (completed speech-to-text)

## Passing JSON Payloads to the Controller

To pass JSON payloads to the controller, you need to:

1. Establish a WebSocket connection to the `/realtime` endpoint
2. Send properly formatted JSON messages over the WebSocket

### Example Client Implementation

```javascript
// Establish connection
const socket = new WebSocket('wss://your-server/realtime');

// Listen for connection confirmation
socket.onopen = () => {
  console.log('Connected to server');
};

// Handle incoming messages
socket.onmessage = (event) => {
  if (event.data instanceof Blob) {
    // Handle binary audio data
    processAudioData(event.data);
  } else {
    // Handle text messages
    const message = JSON.parse(event.data);
    switch (message.type) {
      case 'connected':
        console.log('Connection established:', message.greeting);
        break;
      case 'text_delta':
        console.log('Received text:', message.text);
        break;
      case 'transcription':
        console.log('Transcription:', message.transcript);
        break;
      case 'speech_started':
        console.log('Speech input started');
        break;
    }
  }
};

// Send a text message
function sendTextMessage(text) {
  const message = {
    type: 'user_message',
    text: text
  };
  socket.send(JSON.stringify(message));
}

// Send audio data
function sendAudioData(audioBuffer) {
  socket.send(audioBuffer);
}
```

### JSON Payload Structure

The controller expects client messages to be in a specific format. The primary message type it processes is `ClientReceivableUserMessage`, which has the following structure:

```json
{
  "type": "user_message",
  "text": "Your message content here"
}
```

## Implementation Details

### Message Handling Loops

The controller runs two parallel message-handling loops:

1. `HandleMessagesFromClientAsync`: Receives and processes messages from the WebSocket client
2. `HandleUpdatesFromServiceAsync`: Receives and processes updates from the OpenAI service

### Audio Handling

The controller includes a workaround method `SendAudioToServiceViaWorkaroundAsync` which:
1. Takes binary audio data
2. Converts it to base64
3. Wraps it in a JSON command format for the service
4. Sends it using the session's `SendCommandAsync` method

### Resource Management

The controller properly disposes of:
- WebSocket connections
- Service sessions

## Configuration Requirements

To use this controller, you need to configure either:

### For Azure OpenAI
- `AZURE_OPENAI_ENDPOINT` (required)
- `AZURE_OPENAI_DEPLOYMENT` (required)
- `AZURE_OPENAI_API_KEY` (optional, will use DefaultAzureCredential if not provided)

### For OpenAI
- `OPENAI_API_KEY` (required)
- `OPENAI_ENDPOINT` (optional)
- `OPENAI_MODEL` (optional, defaults to "gpt-4o-realtime-preview")

## Custom Message Passing

If you need to extend the controller to handle additional types of JSON payloads:

1. Create new message classes in the `ClientMessages` namespace
2. Update the message deserialization logic in `HandleMessagesFromClientAsync`
3. Add handlers for new message types

For example, to add a "system message" type:

```csharp
// 1. Add a new message class
public class ClientReceivableSystemMessage : ClientMessage
{
    public string SystemPrompt { get; set; } = "";
}

// 2. Update the handler in HandleMessagesFromClientAsync
if (clientMessage is ClientReceivableSystemMessage systemMessage)
{
    await RealtimeSessionToService.AddItemAsync(
        ConversationItem.CreateSystemMessage([systemMessage.SystemPrompt]), 
        cancellationToken).ConfigureAwait(false);
}
```

## Limitations

- The controller handles one WebSocket connection at a time
- It doesn't implement reconnection logic
- Error handling could be improved with more graceful recovery
- The audio handling uses a workaround method

## Scalability Considerations

The current implementation has significant scalability limitations that would prevent it from being used in a multi-user environment. Here are the key issues and considerations for scaling:

### Current Limitations

1. **Single Connection Per Controller**: The controller maintains state for only one WebSocket connection (`WebSocketToClient` property) and one service session (`RealtimeSessionToService` property).

2. **Connection Overwriting**: If multiple clients try to connect, each new connection will overwrite the previous one, causing:
   - Disconnection of the previous client
   - Loss of conversation state
   - Potential resource leaks
   - Unexpected behavior for users

3. **No Connection Management**: There's no mechanism to:
   - Track multiple connections
   - Associate sessions with specific users
   - Handle connection lifecycle events properly
   - Clean up resources for disconnected clients

4. **No Load Balancing**: The implementation doesn't consider distribution across multiple server instances.

### Approaches for Multi-User Support

To support multiple concurrent users, consider these architectural changes:

1. **Connection Manager**:
   - Implement a service to track and manage WebSocket connections
   - Use a dictionary or similar structure to map connection IDs to WebSocket instances
   - Handle connection lifecycle events (connect, disconnect, timeout)

2. **Session Isolation**:
   - Create separate `RealtimeConversationSession` instances for each client
   - Maintain proper mapping between clients and their respective sessions

3. **Dependency Injection**:
   - Move from instance variables to a more scalable approach using scoped services
   - Use DI container to manage the lifecycle of connections and sessions

4. **SignalR Integration**:
   - Consider replacing raw WebSockets with ASP.NET Core SignalR
   - Leverage built-in connection management, grouping, and scaling features
   - Utilize SignalR's hub pattern for more organized code

5. **Stateless Design**:
   - Redesign the controller to be stateless
   - Store connection information in distributed cache or database
   - Use connection IDs to retrieve state when processing messages

### Infrastructure Considerations

For a production-ready solution that handles multiple users:

1. **Load Balancing**:
   - Deploy multiple instances behind a load balancer
   - Implement sticky sessions or session affinity
   - Consider WebSocket-aware load balancers

2. **State Management**:
   - Use Redis or similar for distributed connection tracking
   - Implement proper cleanup of abandoned connections

3. **Resource Throttling**:
   - Implement rate limiting per user/connection
   - Add connection limits based on server capacity
   - Monitor resource usage and implement backpressure

4. **Health Monitoring**:
   - Add connection health checks
   - Implement automated recovery for failed connections
   - Log connection metrics for performance analysis

### Example Multi-Client Architecture

```csharp
// Connection manager service (simplified example)
public class WebSocketConnectionManager
{
    private readonly ConcurrentDictionary<string, WebSocket> _connections = new();
    private readonly ConcurrentDictionary<string, RealtimeConversationSession> _sessions = new();

    public string AddConnection(WebSocket socket)
    {
        string connectionId = Guid.NewGuid().ToString();
        _connections.TryAdd(connectionId, socket);
        return connectionId;
    }

    public WebSocket GetConnection(string connectionId)
    {
        _connections.TryGetValue(connectionId, out WebSocket? socket);
        return socket;
    }

    public void AddSession(string connectionId, RealtimeConversationSession session)
    {
        _sessions.TryAdd(connectionId, session);
    }

    public RealtimeConversationSession GetSession(string connectionId)
    {
        _sessions.TryGetValue(connectionId, out RealtimeConversationSession? session);
        return session;
    }

    public async Task RemoveConnectionAsync(string connectionId)
    {
        if (_connections.TryRemove(connectionId, out WebSocket? socket))
        {
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, 
                "Connection closed by the server", CancellationToken.None);
        }

        if (_sessions.TryRemove(connectionId, out RealtimeConversationSession? session))
        {
            session.Dispose();
        }
    }
}

// Controller would then be updated to use this manager
// rather than storing connections directly
```

## Conclusion

This controller effectively bridges communication between WebSocket clients and the OpenAI Realtime API service, handling both text and audio data in both directions. By understanding its message flow and expected formats, you can successfully interact with it from client applications.

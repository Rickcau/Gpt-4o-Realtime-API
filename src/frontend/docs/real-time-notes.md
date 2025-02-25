# Refactoring one of my Frontends to make use of the GTP-4o Real-time API
This file is just a place for me to keep some important notes durning the refactor process.

# Lib folder
```
└── lib/
    ├── audio.ts           # Audio recording and playback functionality
    ├── client.ts          # WebSocket client implementation
    └── utils.ts           # Utility functions
```

# I need to add the following capabilities to the main page to support this 
- WebSocket connection management
- Audio recording and playback
- User input (both text and voice)
- Message display and management

The GTP-4o Real-time API uses WebSocket’s not your traditional `request / response` REST pattern, so it's a drastic departure from the traditional Chat Completion Endpoint.

## Audio Handling

The solution needs to use two main clases for audio handling:

1. **Player**: Handles audio playback using the Web Audio API's AudioWorklet
2. **Recorder**: Manages audio recording from the user's microphone

These are implemented in `src/lib/client.ts` it provides a wrapper around the browser's WebSocket API, with:

- Async/await support
- Error handling
- Message queueing
- Support for both binary and text messages

# Application Flow

1. **Connection**: User connects to a WebSocket server by entering the endpoint URL
2. **Communication**:
   - Text input: User types a message and sends it
   - Voice input: User records audio, which is sent to the server in real-time
3. **Response Handling**:
   - Server responses are processed and displayed in the chat interface
   - Audio responses are played back using the audio player

## WebSocket Message Types

The application handles several types of WebSocket messages:

- **text_delta**: Incremental text from the assistant
- **transcription**: Speech-to-text output from recorded audio
- **user_message**: Messages from the user
- **control**: Control messages like "speech_started", "connected", or "text_done"
- **binary**: Binary audio data (for both sending and receiving)

## Audio Processing

- **Recording**: Audio is captured at 24kHz, processed through an AudioWorklet, and sent to the server as binary data
- **Playback**: Audio received from the server is played back using a dedicated playback AudioWorklet

### Audio Worklet Files

The application uses two important AudioWorklet files that run audio processing in separate threads:

1. **record-worklet.js**: 
   - Handles the microphone audio stream processing
   - Processes raw audio input and converts it to the appropriate format
   - Buffers audio data and sends it to the main thread for transmission
   - Referenced in `audio.ts` Recorder class with `addModule("./record-worklet.js")`

2. **playback-worklet.js**:
   - Processes incoming audio data from the server
   - Manages audio playback buffer and timing
   - Converts audio data to the appropriate format for playback
   - Referenced in `audio.ts` Player class with `addModule("playback-worklet.js")`

These worklet files are crucial for efficient audio processing as they:
- Run in a separate thread to prevent blocking the main UI thread
- Handle real-time audio processing with minimal latency
- Manage audio buffering and streaming
- Process audio data at the required 24kHz sample rate

When the application initializes the audio system, it loads these worklet modules into the AudioContext, establishing the audio processing pipeline for both recording and playback functionality.

### Understanding AudioWorklet Files

An AudioWorklet file is a specialized JavaScript file containing code that runs in a dedicated audio processing thread, separate from the main JavaScript thread. These files are a part of the Web Audio API and provide several key advantages:

#### Structure and Operation

A typical AudioWorklet file contains a class that extends `AudioWorkletProcessor` and implements a `process` method:

```javascript
class MyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Initialization code
  }

  process(inputs, outputs, parameters) {
    // Audio processing logic - called repeatedly with chunks of audio data
    return true; // Return true to keep the processor alive
  }
}

registerProcessor('my-processor', MyProcessor);
```

#### Key Benefits

1. **Performance**: AudioWorklets run in a separate high-priority thread dedicated to audio processing, ensuring smooth, glitch-free audio handling.

2. **Real-time Processing**: They enable real-time manipulation of audio streams without impacting UI responsiveness.

3. **Low Latency**: They provide minimal delay between audio input and output, crucial for interactive applications.

4. **Custom Audio Processing**: They allow implementing custom audio algorithms beyond what browsers provide natively.

#### Integration in the Application

1. **Loading**: Audio worklet files are loaded using `audioContext.audioWorklet.addModule(path-to-worklet)`.

2. **Connection**: After loading, the application creates `AudioWorkletNode` instances that connect to these processors.

3. **Communication**: The main thread communicates with worklet processors using a message-passing interface through the `port` property.

AudioWorklets represent a significant improvement over older approaches like ScriptProcessorNode, which ran on the main thread and could cause audio glitches when the UI was busy.

### Location and Usage of Worklet Files

The worklet files are **only loaded and used in the audio.ts file**, not in client.ts or other files:

1. **playback-worklet.js** is loaded in the `Player` class's `init` method:
   ```typescript
   async init(sampleRate: number) {
     if (this.playbackNode === null) {
       const audioContext = new AudioContext({ sampleRate });
       await audioContext.audioWorklet.addModule("playback-worklet.js");

       this.playbackNode = new AudioWorkletNode(audioContext, "playback-worklet");
       this.playbackNode.connect(audioContext.destination);
     }
   }
   ```

2. **record-worklet.js** is loaded in the `Recorder` class's `start` method:
   ```typescript
   async start(stream: MediaStream) {
     try {
       this.audioContext = new AudioContext({ latencyHint: "interactive", sampleRate: 24000, });
       await this.audioContext.audioWorklet.addModule(
         "./record-worklet.js",
       );
       // More code that creates nodes and connections
     } catch (error) {
       this.stop();
     }
   }
   ```

The physical worklet files themselves are likely located in the **public directory** of the Next.js application, making them accessible at runtime via URL paths. This is the standard pattern because:

1. The browser needs to fetch these files directly at runtime
2. They need to be accessible via a URL that the browser can request
3. Next.js serves files from the public directory at the root path of the application

Unlike regular JavaScript modules, worklet files aren't imported directly into the application code. Instead, they're loaded asynchronously at runtime through the AudioContext's `audioWorklet.addModule()` method, which fetches and compiles the worklet code in the separate audio processing thread.

## UI Components

The UI is built using a combination of custom components and the shadcn/ui component library, which provides:

- Accessible UI elements
- Responsive design
- Consistent styling through Tailwind CSS

## Setting Up and Running

The application can be run with the following commands:

- `npm run dev`: Start the development server
- `npm run build`: Build the application for production
- `npm run start`: Start the production server
- `npm run lint`: Run ESLint for code linting
- `npm run format`: Format code using Prettier

## Connection Requirements

To use the application, you need to connect to a compatible WebSocket server endpoint that can:

1. Process audio input (speech-to-text)
2. Generate responses
3. Optionally provide speech synthesis (text-to-speech)

The default endpoint is `ws://localhost:8080/realtime`, but this can be changed in the UI. 
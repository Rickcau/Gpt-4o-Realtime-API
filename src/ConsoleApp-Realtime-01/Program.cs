using Azure.AI.OpenAI;
using Azure.Identity;
using OpenAI;
using OpenAI.RealtimeConversation;
using System.ClientModel;
using dotenv.net;

#pragma warning disable OPENAI002
public class Program
{
    private static volatile bool isPlayingResponse = false;
    private static SemaphoreSlim conversationCompletedSemaphore = new SemaphoreSlim(0, 1);

    public static async Task Main(string[] args)
    {
        // Load .env file
        DotEnv.Load(options: new DotEnvOptions(probeForEnv: true));

        // RDC - lets setup a List of messages for future use.
        var messages = new List<Dictionary<string, string>>
        {
            new Dictionary<string, string>
            {
                { "role", "system" },
                { "content", "You are a knowledgeable assistant that provides expert advice on audio streaming and NAudio integration." }
            },
            new Dictionary<string, string>
            {
                { "role", "user" },
                { "content", "How can I improve playback performance in my SpeakerOutput.cs implementation?" }
            }
        };

        // Create a client according to configured environment variables
        RealtimeConversationClient client = GetConfiguredClient();
        using RealtimeConversationSession session = await client.StartConversationSessionAsync();

        // Configure the session with transcription options
        await session.ConfigureSessionAsync(new ConversationSessionOptions()
        {
            InputTranscriptionOptions = new()
            {
                Model = "whisper-1",
            },
        });

        // Setup speaker output
        SpeakerOutput speakerOutput = new();

        // Start microphone capture
        Console.WriteLine(" >>> Starting a single conversation interaction");
        Console.WriteLine(" >>> Please speak. The app will process your input and respond once.");
        Console.WriteLine();

        using MicrophoneAudioStream microphoneInput = MicrophoneAudioStream.Start();

        // Start a task to process incoming updates
        Task processUpdatesTask = ProcessUpdatesAsync(session, microphoneInput, speakerOutput);

        // Start sending audio from the microphone
        Task sendAudioTask = session.SendInputAudioAsync(microphoneInput);

        // Wait for the conversation to complete
        await conversationCompletedSemaphore.WaitAsync();

        // Clean up
        Console.WriteLine(" >>> Single interaction completed. Press any key to exit.");
        Console.ReadKey(true);
    }

    private static async Task ProcessUpdatesAsync(
        RealtimeConversationSession session,
        MicrophoneAudioStream microphoneInput,
        SpeakerOutput speakerOutput)
    {
        bool responseComplete = false;

        await foreach (ConversationUpdate update in session.ReceiveUpdatesAsync())
        {
            if (update is ConversationSessionStartedUpdate)
            {
                Console.WriteLine(" <<< Connected: session started");
            }
            else if (update is ConversationInputSpeechStartedUpdate speechStartedUpdate)
            {
                Console.WriteLine($" <<< Start of speech detected @ {speechStartedUpdate.AudioStartTime}");
            }
            else if (update is ConversationInputSpeechFinishedUpdate speechFinishedUpdate)
            {
                Console.WriteLine($" <<< End of speech detected @ {speechFinishedUpdate.AudioEndTime}");
                // Stop recording once speech is finished
                microphoneInput.StopRecording();
            }
            else if (update is ConversationInputTranscriptionFinishedUpdate transcriptionFinishedUpdate)
            {
                Console.WriteLine($" >>> USER: {transcriptionFinishedUpdate.Transcript}");
            }
            else if (update is ConversationItemStreamingPartDeltaUpdate deltaUpdate)
            {
                // Process streaming text
                if (!string.IsNullOrEmpty(deltaUpdate.Text))
                {
                    Console.Write(deltaUpdate.Text);
                }

                // Process streaming audio
                if (deltaUpdate.AudioBytes != null)
                {
                    // Stop the microphone and start playback
                    isPlayingResponse = true;
                    speakerOutput.EnqueueForPlayback(deltaUpdate.AudioBytes);
                }
            }
            else if (update is ConversationItemStreamingFinishedUpdate)
            {
                Console.WriteLine();
                Console.WriteLine(" <<< Response complete");

                // Mark the conversation as complete
                responseComplete = true;
                conversationCompletedSemaphore.Release();
                break;
            }
            else if (update is ConversationErrorUpdate errorUpdate)
            {
                Console.WriteLine();
                Console.WriteLine($" <<< ERROR: {errorUpdate.Message}");
                Console.WriteLine(errorUpdate.GetRawContent().ToString());

                // Release the semaphore to allow the app to exit
                if (!responseComplete)
                {
                    conversationCompletedSemaphore.Release();
                }
                break;
            }
        }
    }

    private static RealtimeConversationClient GetConfiguredClient()
    {
        string? aoaiEndpoint = Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT");
        string? aoaiUseEntra = Environment.GetEnvironmentVariable("AZURE_OPENAI_USE_ENTRA");
        string? aoaiDeployment = Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT");
        string? aoaiApiKey = Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY");
        string? oaiApiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY");

        if (aoaiEndpoint is not null && bool.TryParse(aoaiUseEntra, out bool useEntra) && useEntra)
        {
            return GetConfiguredClientForAzureOpenAIWithEntra(aoaiEndpoint, aoaiDeployment);
        }
        else if (aoaiEndpoint is not null && aoaiApiKey is not null)
        {
            return GetConfiguredClientForAzureOpenAIWithKey(aoaiEndpoint, aoaiDeployment, aoaiApiKey);
        }
        else if (aoaiEndpoint is not null)
        {
            throw new InvalidOperationException(
                $"AZURE_OPENAI_ENDPOINT configured without AZURE_OPENAI_USE_ENTRA=true or AZURE_OPENAI_API_KEY.");
        }
        else if (oaiApiKey is not null)
        {
            return GetConfiguredClientForOpenAIWithKey(oaiApiKey);
        }
        else
        {
            throw new InvalidOperationException(
                $"No environment configuration present. Please provide one of:\n"
                    + " - AZURE_OPENAI_ENDPOINT with AZURE_OPENAI_USE_ENTRA=true or AZURE_OPENAI_API_KEY\n"
                    + " - OPENAI_API_KEY");
        }
    }

    private static RealtimeConversationClient GetConfiguredClientForAzureOpenAIWithEntra(
        string aoaiEndpoint,
        string? aoaiDeployment)
    {
        Console.WriteLine($" * Connecting to Azure OpenAI endpoint (AZURE_OPENAI_ENDPOINT): {aoaiEndpoint}");
        Console.WriteLine($" * Using Entra token-based authentication (AZURE_OPENAI_USE_ENTRA)");
        Console.WriteLine(string.IsNullOrEmpty(aoaiDeployment)
            ? $" * Using no deployment (AZURE_OPENAI_DEPLOYMENT)"
            : $" * Using deployment (AZURE_OPENAI_DEPLOYMENT): {aoaiDeployment}");

        AzureOpenAIClient aoaiClient = new(new Uri(aoaiEndpoint), new DefaultAzureCredential());
        return aoaiClient.GetRealtimeConversationClient(aoaiDeployment);
    }

    private static RealtimeConversationClient GetConfiguredClientForAzureOpenAIWithKey(
        string aoaiEndpoint,
        string? aoaiDeployment,
        string aoaiApiKey)
    {
        Console.WriteLine($" * Connecting to Azure OpenAI endpoint (AZURE_OPENAI_ENDPOINT): {aoaiEndpoint}");
        Console.WriteLine($" * Using API key (AZURE_OPENAI_API_KEY): {aoaiApiKey[..5]}**");
        Console.WriteLine(string.IsNullOrEmpty(aoaiDeployment)
            ? $" * Using no deployment (AZURE_OPENAI_DEPLOYMENT)"
            : $" * Using deployment (AZURE_OPENAI_DEPLOYMENT): {aoaiDeployment}");

        AzureOpenAIClient aoaiClient = new(new Uri(aoaiEndpoint), new ApiKeyCredential(aoaiApiKey));
        return aoaiClient.GetRealtimeConversationClient(aoaiDeployment);
    }

    private static RealtimeConversationClient GetConfiguredClientForOpenAIWithKey(string oaiApiKey)
    {
        string oaiEndpoint = "https://api.openai.com/v1";
        Console.WriteLine($" * Connecting to OpenAI endpoint (OPENAI_ENDPOINT): {oaiEndpoint}");
        Console.WriteLine($" * Using API key (OPENAI_API_KEY): {oaiApiKey[..5]}**");

        OpenAIClient aoaiClient = new(new ApiKeyCredential(oaiApiKey));
        return aoaiClient.GetRealtimeConversationClient("gpt-4o-realtime-preview-2024-10-01");
    }
}

using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using NAudio.Wave;

// RDC new version of SpeakerOutput
// The idea here is to decouple the audio processing from the UI updates
// Instead of checking conditions and starting playback in the EnqueueForPlayback method, you can simply
// enqueue the audio data and hace the dededicated background task process the audio buffer
// independently. 

public class SpeakerOutput : IDisposable
{
    private readonly BufferedWaveProvider _waveProvider;
    private readonly WaveOutEvent _waveOutEvent;
    private readonly ConcurrentQueue<byte[]> _audioQueue = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _processingTask;
    private readonly object _audioLock = new();

    private const int BUFFER_THRESHOLD_MS = 500;

    public SpeakerOutput()
    {
        WaveFormat outputAudioFormat = new(24000, 16, 1);
        _waveProvider = new BufferedWaveProvider(outputAudioFormat)
        {
            // RDC old
            // BufferDuration = TimeSpan.FromSeconds(5),
            BufferDuration = TimeSpan.FromMinutes(2),
            // DiscardOnBufferOverflow = true
        };

        _waveOutEvent = new WaveOutEvent
        {
            DesiredLatency = 300,
            NumberOfBuffers = 4
        };

        // Initialize playback once.
        _waveOutEvent.Init(_waveProvider);
        _waveOutEvent.Play();

        // Start a background task to process the queued audio data.
        _processingTask = Task.Run(ProcessAudioQueue);
    }

    public void EnqueueForPlayback(BinaryData audioData)
    {
        // Simply enqueue the data without any conditional playback logic.
        _audioQueue.Enqueue(audioData.ToArray());
    }

    private async Task ProcessAudioQueue()
    {
        while (!_cts.Token.IsCancellationRequested)
        {
            if (_audioQueue.TryDequeue(out byte[] buffer))
            {
                // Optionally, if you want to keep thread-safety (though BufferedWaveProvider is thread-safe for adding samples),
                // you can lock here:
                lock (_audioLock)
                {
                    _waveProvider.AddSamples(buffer, 0, buffer.Length);
                }
            }
            else
            {
                // If there's no audio data, wait a short time to prevent a tight loop.
                await Task.Delay(10);
            }
        }
    }

    public void ClearPlayback()
    {
        _waveProvider.ClearBuffer();
    }

    public void Dispose()
    {
        _cts.Cancel();
        try
        {
            _processingTask.Wait();
        }
        catch { }
        _waveOutEvent?.Dispose();
        _cts.Dispose();
    }
}

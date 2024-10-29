# Speakr Integration Guide

This guide provides instructions for integrating **Speakr** with **Twilio** to build an AI-powered voice solution.

## Prerequisites

Before you begin, ensure you have the following:

- **Node.js** (version 14.x or higher)
- **npm** (version 6.x or higher)
- A **Speakr API Key** (visit Speakr to obtain it)
- **Twilio Account** (with necessary configurations for handling voice streams)

## Getting Started

1. Clone the repository, which contains all the necessary code for Twilio logic.
2. Implement all Twilio-related logic, referencing the provided code.
3. If needed, refer to the official [Twilio Voice API Documentation](https://www.twilio.com/docs/voice/make-calls) for guidance on making and handling voice calls.

## Speakr Integration

The integration between Speakr and Twilio involves handling real-time voice streams. Speakr acts as the STT (speech-to-text) processor but with an additional layer of interaction, where you send and receive voice streams.

### 1. Connect to the Speakr WebSocket

You'll need to establish a WebSocket connection to the Speakr API using your Speakr API key.

```javascript
const speakrws = new WebSocket(
  `${speakr_websocket_url}?api_key=${speakr_api_key}`
);
```

### 2. WebSocket Events

Speakr WebSocket sends various events during the interaction, which you need to handle accordingly:

| Event    | Description                                                                   |
| -------- | ----------------------------------------------------------------------------- |
| initial  | When the WebSocket connection is established                                  |
| ready    | When Speakr is ready to receive and process media                             |
| media    | The audio buffer encoded in Base64 that you need to send to Twilio            |
| pause    | Indicates when the user interrupts the conversation                           |
| continue | Indicates that the interruption was not intentional and should be disregarded |
| clear    | Indicate an intentional interruption                                          |
| info     | Provides information about errors or issues with the API                      |
| end      | Indicates that the Speakr WebSocket connection has been closed                |

### 3. Handling WebSocket Events

### `initial` Event

When the `initial` event is triggered, send the necessary parameters to Speakr to configure the voice session.


- To initiate the connection, the client must send a message with the required parameters: `temperature`, `voice`, `silenceDuration`, `threshold`, and a `system_prompt`. Below is the structured format for the message:

#### Parameters:
- **temperature**: Range 0 to 1 (ideal: 0.7)
- **voice**: Options are either `"jill"` or `"jack"`
- **silenceDuration**: Range 10ms to 100ms (ideal: 100ms)
- **threshold**: Range 0 to 1 (ideal: 0.18)
- **system_prompt**: Provide the system prompt as a string
- **sessionId**: A unique session identifier as a string

- Speaker offers two voice options: Jill and Jack.
- You can try out both voices in the Speaker playground.

```javascript
{
    type: "start",
    msg: JSON.stringify({
        temperature: 0.7,                    // Example: 0.7
        voice_id: "jill",                    // Example: "jill"
        voice_provider: "speakr_eng_v1",             // Keep this value constant
        silenceDuration: 100,               // Example: 100
        threshold: 0.18,                     // Example: 0.18
        system_prompt: "",                   // Yor are a friendly AI assistant
        sessionId: uuid,                     // Example: "12345"
    }),
}
```

Parameters you should include:

- `voice_id`: The voice model to be used
- `silenceDuration`: The duration of silence allowed before considering it an interruption
- `sessionId`: A unique identifier for the session
- `temperature`: Controls the randomness of the model’s responses
- `threshold`: The threshold for voice detection

### `ready` Event

Once the `ready` event is received, Speakr is prepared to receive audio. The media (audio buffer) sent to Speakr must be encoded in **linear16** format with an 8000Hz sample rate. Each chunk should be 512 bytes in size.

```javascript
function decodeAndSendMulawChunks(buffer, session) {
  const wav = new WaveFile();
  wav.fromScratch(1, 8000, "8m", Buffer.from(buffer)); // Mu-law encoded data
  wav.fromMuLaw(); // Decode from mu-law to PCM

  // Access the PCM data (16-bit, 8000 Hz)
  const samples = new Int16Array(wav.data.samples.buffer); // Ensure it's an Int16Array (16-bit PCM)

  // Define constants for chunking
  const CHUNK_SIZE = 512; // 512 bytes = 256 samples for 16-bit audio
  const bytesPerSample = 2; // 16-bit PCM = 2 bytes per sample
  const samplesPerChunk = CHUNK_SIZE / bytesPerSample; // 256 samples per chunk
  let offset = 0;

  while (offset < samples.length) {
    let chunk;

    if (offset + samplesPerChunk <= samples.length) {
      // Normal case: slice a chunk of exactly 512 bytes (256 samples)
      chunk = samples.slice(offset, offset + samplesPerChunk);
    } else {
      // Last chunk: smaller than 512 bytes, pad with silence (zeros)
      const remainingSamples = samples.length - offset;
      const paddedChunk = new Int16Array(samplesPerChunk); // Initialize with zeros (silent padding)
      paddedChunk.set(samples.slice(offset, offset + remainingSamples), 0); // Copy remaining samples
      chunk = paddedChunk; // Ensure it's exactly 512 bytes
    }

    // Ensure the chunk is converted into a Buffer of exactly 512 bytes
    session.speakrws.send(Buffer.from(chunk.buffer));
    offset += samplesPerChunk; // Move to next chunk (256 samples / 512 bytes)
  }
}
const buffer = Buffer.from(msg.media.payload, "base64");
decodeAndSendMulawChunks(buffer, session);
```

The `decodeAndSendMulawChunks` function (defined later) handles converting and sending the audio to Twilio.

### `media` Event

When you receive a `media` event, you get the audio buffer from Speakr, which you need to send to Twilio. The buffer is in **linear16** format at a 24kHz sample rate, but Twilio requires **mu-law encoding** at 8kHz.

You also need to send the **session_id** and **sequence_id** of the buffer as a mark message to Twilio right after sending the buffer.

Use the provided helper functions to convert the buffer before sending it to Twilio.

```javascript
const message = Buffer.from(msg, "base64");
const metadataEndIndex = message.indexOf(0);
const metadataString = message.slice(0, metadataEndIndex).toString("utf-8");
const bufferWithoutMetadata = message.slice(metadataEndIndex + 1);
const { session_id, sequence_id } = JSON.parse(metadataString);

const inputSampleRate = 24000;

const downsampledBuffer = downsampleTo8000Hz(
  bufferWithoutMetadata,
  inputSampleRate
);

const mulawbuffer = encodeToMuLaw(downsampledBuffer);
const base64buffer = mulawbuffer.toString("base64");

const mediaMessage = {
  event: "media",
  streamSid: session.streamSid,
  media: {
    payload: base64buffer,
  },
};
await twiliows.send(JSON.stringify(mediaMessage));

const markMessage = {
  event: "mark",
  streamSid: session.streamSid,
  mark: {
    name: `${sequence_id}session_id${session_id}`,
  },
};
await twiliows.send(JSON.stringify(markMessage));
```

### `pause` Event

This event occurs when the user interrupts the conversation. However, it might not always indicate an intentional interruption. You can clear the buffer sent to Twilio but handle it with caution.

```javascript
await twiliows.send(
  JSON.stringify({
    event: "clear",
    streamSid: session.streamSid,
  })
);
```

### `continue` Event

If the interruption is not significant, replay the previous response's buffer from where the interruption occurred.

### `clear` Event

This event indicates an actual interruption, and you should proceed to handle the user’s query.

### `info` Event

This event contains details about errors or issues with API parameters or authentication.

### `end` Event

This event signifies the closure of the Speakr WebSocket connection. Perform any necessary cleanup.

## Twilio Mark Implementation

When Twilio successfully plays a buffer, it sends a `mark` event back. This event contains the `sequence_id` and `session_id` that you had sent earlier. You need to send these identifiers to Speakr to notify it that the buffer was played.

```javascript
const markMessage = JSON.parse(message);
const markText = markMessage?.mark?.name;
if (markText) {
  const detectIndex = markText.indexOf("session_id");
  if (detectIndex !== -1) {
    const sequence_id = markText.substring(0, detectIndex);
    const session_id = markText.substring(detectIndex + "session_id".length);
    speakrws.send(
      JSON.stringify({
        type: "status",
        msg: {
          session_id: session_id,
          sequence_id: sequence_id,
        },
      })
    );
  }
}
```

## Helper Functions

Below are essential functions for encoding, decoding, and downsampling audio buffers.

```javascript
function encodeMuLaw(sample) {
  const MAX = 0x7fff; // Max value for 16-bit PCM (32767)
  const BIAS = 0x84; // μ-law bias (132)

  // Get sign bit (1 for negative, 0 for positive)
  let sign = (sample >> 8) & 0x80;

  if (sample < 0) sample = -sample; // Take absolute value of sample

  // Clamp to max value
  if (sample > MAX) sample = MAX;

  // Add bias, apply logarithmic compression
  sample += BIAS;
  let exponent = Math.floor(Math.log(sample) / Math.LN2) - 7; // Logarithmic scaling

  if (exponent < 0) exponent = 0; // Ensure exponent is non-negative

  const mantissa = (sample >> (exponent + 3)) & 0x0f; // Extract mantissa (4 bits)
  let muLawByte = ~(sign | (exponent << 4) | mantissa); // Combine sign, exponent, and mantissa

  return muLawByte & 0xff; // Return as byte
}

function encodeToMuLaw(pcmBuffer) {
  const muLawBuffer = Buffer.alloc(pcmBuffer.length / 2); // Each 16-bit PCM sample becomes 1 byte in mu-law

  for (let i = 0; i < pcmBuffer.length / 2; i++) {
    // Read the 16-bit PCM sample (signed)
    const sample = pcmBuffer.readInt16LE(i * 2);

    // Encode the sample to μ-law
    muLawBuffer[i] = encodeMuLaw(sample);
  }

  return muLawBuffer;
}

function downsampleTo8000Hz(buffer, inputSampleRate) {
  const targetSampleRate = 8000;
  const sampleRatio = inputSampleRate / targetSampleRate; // Ratio for downsampling

  const downsampledLength = Math.floor(buffer.length / (sampleRatio * 2)); // Each sample is 2 bytes
  const downsampledBuffer = Buffer.alloc(downsampledLength * 2); // Create a buffer for 16-bit samples

  // Select samples at intervals of 'sampleRatio' to reduce the sample rate
  for (let i = 0; i < downsampledLength; i++) {
    const originalSampleIndex = Math.floor(i * sampleRatio);
    const offset = originalSampleIndex * 2; // Each 16-bit sample is 2 bytes

    // Ensure the offset is within the valid range of the buffer
    if (offset + 1 < buffer.length) {
      const sample = buffer.readInt16LE(offset); // Read the 16-bit PCM sample
      downsampledBuffer.writeInt16LE(sample, i * 2); // Write it into the downsampled buffer
    }
  }

  return downsampledBuffer; // Return the downsampled buffer as a Buffer
}
```

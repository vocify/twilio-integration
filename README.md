<!-- # Speakr Integration Guide

This guide will walk you through integrating speakr with twilio

## Prerequisites

Before getting started, ensure that you have the following:

- Node.js (version 14.x or higher)
- npm (version 6.x or higher)
- A Speakr API Key (visit Speakr to obtain it)

## Getting Started

- Implement all the twilio logic if needed you can take help from the code provided in the repo
- You refer to the [twilio documentation](https://www.twilio.com/docs/voice/make-calls) for any dobut you have

## speakr integration

- If you have any pervious experience in building the AI voice solution then you can think speakr as the stt but now you have to send the stream and you will get the stream same as stt providers provides

- Connect to the speakr websocket

```javascript
const speakrws = new WebSocket(
  `${speakr_websocket_url}?api_key=${speakr_api_key}`
);
```

| Event    | Description                                                                       |
| -------- | --------------------------------------------------------------------------------- |
| initial  | when the websocket connection is ready                                            |
| ready    | when spaker is ready to assist you                                                |
| media    | the audio buffer encoded with base64                                              |
| pause    | when user has intrupted                                                           |
| continue | if the intruption is not a required one or not have to be treated as a intruption |
| clear    | When the buffer which have sent to twilio has to be cleared                       |
| info     | the information about the errors and the api is received here                     |
| end      | when the speakr websocket conneciton is closed                                    |

### Thing which you have to do with the events

#### initial

- Send the paramaters to the speakr like voice_id, silence_duration, session_id, system_prompt, temperature, threshold

- the format for the start message looks like

```javascript
{
    type: "start",
    msg: JSON.stringify({
    temperature: 0.7,
    prefixPadding: 0.7,
    voice_id: "jill",
    silenceDuration: 1000,
    threshold: 0.18,
    system_prompt: "You are a helpfull assistant",
    sessionId: uuid,
    }),
}
```

#### ready

- Ready will be received when speakr is ready to communicate properly

- Once the ready is received you can send media to the speakr.
- The media has to be encoded in liner16 with a sample rate of 8000 and the size of each chunk you are sending should be 512 bytes

- decodeAndSendMulawChunks and other required functions can be founded in the end of the readme.md file

```javascript
const buffer = Buffer.from(msg.media.payload, "base64");
decodeAndSendMulawChunks(buffer, session);
```

### media

- As you are sending the buffer to the speakr you will receive the buffer which ypu have to send to the twilio back

- When you receive the buffer you also receive the sequence_id and session_id encoded with the buffer which you have to encode and send to twilio as a mark

- The buffer received from speakr in liner16 encoded with sample rate of 24000 but twilio accept mulaw encoded buffer of sample rate 8000 for this purpose all the neccessay function are available in the repo and also can be find at the end of the readme

```javascript
const message = Buffer.from(msg, "base64");
const metadataEndIndex = message.indexOf(0);
const metadataString = message.slice(0, metadataEndIndex).toString("utf-8");
const bufferWithoutMetadata = message.slice(metadataEndIndex + 1);
const { session_id, sequence_id } = JSON.parse(metadataString);
console.log(session_id, sequence_id);

if (bufferWithoutMetadata.length <= 0) return;

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

- The response of these mark message are received back from twilio as the buffer is played
- This is the assority that the perticular buffer is played on the client's device

# pause

- This event is received when user intupt during the conversation
- But this is not confirm that this is a intruption or user is making the normal communication with the ai like saying ok for the ai response but not wanted to take this as an intruption
- You will clear the buffer sent to twilio as you don't know this is an intruption or not

```javascript
await twiliows.send(
  JSON.stringify({
    event: "clear",
    streamSid: session.streamSid,
  })
);
```

# continue

- This the indication that the intrupion is not a required intruption or user has no intent to intrupt the conversation
- then in this case you have to play the buffer of the last reaponse which was playing when the intruption happned
- You can make an array for all the response and store the sequence no on which the intruption was made and can send the buffer again to twilio

# clear

- this is the event where you have to actually intrupt the conversation

```javascript
await twiliows.send(
  JSON.stringify({
    event: "clear",
    streamSid: session.streamSid,
  })
);
```

- Now you will receive the buffer for the response of the user's query

# info

- the event contains the information about the api key error or any error occured because of any parameter

# end

- This is the indication that the speakr webcoekt connection is closed

**This is important to implement using the twilio mark**

- You will get the event mark from twilio which contains the sequence_id and the session_id which you have sent to twilio when sending buffer

- When the buffer is played after which they are sent twilio sent back them idication the sequence_id and session_id is played

```javascript
const markMessage = JSON.parse(message);
const markText = markMessage?.mark?.name;
if (!markText) {
    break;
}
const detectIndex = markText.indexOf("session_id");
if (detectIndex !== -1) {
    const numberStartIndex = detectIndex + "session_id".length;
    const sequence_id = markText.substring(0, detectIndex);
    const session_id = markText.substring(numberStartIndex);
    // Send the status of the played buffer to speakr
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
```

#### All the neccessary functions

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
``` -->


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

| Event    | Description                                                                       |
| -------- | --------------------------------------------------------------------------------- |
| initial  | When the WebSocket connection is established and ready                            |
| ready    | When Speakr is ready to receive and process media                                 |
| media    | The audio buffer encoded in Base64 that you need to send to Twilio                |
| pause    | Indicates when the user interrupts the conversation                               |
| continue | Indicates that the interruption was not intentional and should be disregarded     |
| clear    | Clears the buffer sent to Twilio                                                  |
| info     | Provides information about errors or issues with the API                          |
| end      | Indicates that the Speakr WebSocket connection has been closed                    |

### 3. Handling WebSocket Events

#### `initial` Event

When the `initial` event is triggered, send the necessary parameters to Speakr to configure the voice session.

```javascript
{
    type: "start",
    msg: JSON.stringify({
        temperature: 0.7,
        prefixPadding: 0.7,
        voice_id: "jill",
        silenceDuration: 1000,
        threshold: 0.18,
        system_prompt: "You are a helpful assistant",
        sessionId: uuid,
    }),
}
```

Parameters you should include:
- `voice_id`: The voice model to be used
- `silenceDuration`: The duration of silence allowed before considering it an interruption
- `sessionId`: A unique identifier for the session
- `temperature`: Controls the randomness of the model’s responses
- `threshold`: The threshold for voice detection

#### `ready` Event

Once the `ready` event is received, Speakr is prepared to receive audio. The media (audio buffer) sent to Speakr must be encoded in **linear16** format with an 8000Hz sample rate. Each chunk should be 512 bytes in size.

```javascript
const buffer = Buffer.from(msg.media.payload, "base64");
decodeAndSendMulawChunks(buffer, session);
```

The `decodeAndSendMulawChunks` function (defined later) handles converting and sending the audio to Twilio.

#### `media` Event

When you receive a `media` event, you get the audio buffer from Speakr, which you need to send to Twilio. The buffer is in **linear16** format at a 24kHz sample rate, but Twilio requires **mu-law encoding** at 8kHz.

Use the provided helper functions to convert the buffer before sending it to Twilio.

```javascript
const message = Buffer.from(msg, "base64");
const metadataEndIndex = message.indexOf(0);
const metadataString = message.slice(0, metadataEndIndex).toString("utf-8");
const bufferWithoutMetadata = message.slice(metadataEndIndex + 1);
const { session_id, sequence_id } = JSON.parse(metadataString);

const inputSampleRate = 24000;

const downsampledBuffer = downsampleTo8000Hz(bufferWithoutMetadata, inputSampleRate);

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

#### `pause` Event

This event occurs when the user interrupts the conversation. However, it might not always indicate an intentional interruption. You can clear the buffer sent to Twilio but handle it with caution.

```javascript
await twiliows.send(
  JSON.stringify({
    event: "clear",
    streamSid: session.streamSid,
  })
);
```

#### `continue` Event

If the interruption is not significant, replay the previous response's buffer from where the interruption occurred.

#### `clear` Event

This event indicates an actual interruption, and you should proceed to handle the user’s query.

#### `info` Event

This event contains details about errors or issues with API parameters or authentication.

#### `end` Event

This event signifies the closure of the Speakr WebSocket connection. Perform any necessary cleanup.

### Twilio Mark Implementation

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

### Helper Functions

Below are essential functions for encoding, decoding, and downsampling audio buffers.

```javascript
function decodeAndSendMulawChunks(buffer, session) {
  const wav = new WaveFile();
  wav.fromScratch(1, 8000, "8m", Buffer.from(buffer)); 
  wav.fromMuLaw(); 

  const samples = new Int16Array(wav.data.samples.buffer);

  const CHUNK_SIZE = 512; 
  const samplesPerChunk = CHUNK_SIZE / 2; 
  let offset = 0;

  while (offset < samples.length) {
    let chunk = samples.slice(offset, offset + samplesPerChunk);
    session.speakrws.send(Buffer.from(chunk.buffer));
    offset += samplesPerChunk;
  }
}

function encodeMuLaw(sample) {
  const MAX = 0x7fff;
  const BIAS = 0x84;

  let sign = (sample >> 8) & 0x80;

  if (sample < 0) sample = -sample;
  if (sample > MAX) sample = MAX;

  sample += BIAS;
  let exponent = Math.floor(Math.log(sample) / Math.LN2) - 7;

  if (exponent < 0) exponent = 0;

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  let muLawByte = ~(sign | (exponent << 4) | mantissa);

  return muLawByte & 0xff;
}

function encodeToMuLaw(pcmBuffer) {
  const muLawBuffer = Buffer.alloc(pcmBuffer.length / 2);

  for (let i = 0; i < pcmBuffer.length / 2; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    muLawBuffer[i] = encodeMuLaw(sample);
  }

  return muLawBuffer;
}

function downsampleTo8000Hz(buffer, inputSampleRate) {
  const sampleRatio = inputSampleRate / 8000;
  const downsampledLength = Math.floor(buffer.length / (sampleRatio * 2));
  const downsampledBuffer = Buffer.alloc(downsampledLength * 2);

  for (let i = 0; i < downsampledLength; i++) {
    const originalSampleIndex = Math.floor(i * sampleRatio);
    const offset = originalSampleIndex * 2;

    if (offset + 1 < buffer.length) {
      const sample = buffer.readInt16LE(offset);
      downsampledBuffer.writeInt16LE(sample, i * 2);
    }
  }

  return downsampledBuffer;
}
```
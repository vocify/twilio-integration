const { Buffer } = require("node:buffer");
const WebSocket = require("ws");
const { speakr_api_key, speakr_websocket_url } = require("../config.js");
const Session = require("../utlis/session.js");
const { v4: uuidv4 } = require("uuid");
const WaveFile = require("wavefile").WaveFile;

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

const handleRealTimeStream = async (ws, req) => {
  const { campaignID, clientID, ClientName } = req.params;
  const uuid = uuidv4();
  try {
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
  } catch (err) {
    console.log("Error in sending to the speakr : ", err);
  }

  const session = new Session();
  try {
    // Function to make connection with the speakr
    const connectTospeakr = async (session) => {
      session.speakrws = new WebSocket(
        `${speakr_websocket_url}?api_key=${speakr_api_key}`
      );

      // All the message received from the speakr
      session.speakrws.on("message", async (message) => {
        try {
          const { type, msg } = JSON.parse(message);
          switch (type) {
            // Received when the connection is established
            case "initial":
              session.speakrws.send(
                JSON.stringify({
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
                })
              );
              break;
            // Received when the speakr connection is ready
            case "ready":
              session.cansendtospeakr = true;
              break;
            // Any info or error
            case "info":
              console.log({ type, msg });
              break;
            // For clearing the buffer so that the user experience is improved
            case "pause":
              // This is the case when a user intrupts then we have to clear the buffer but that that can be tha case that the intruption which we get from the user side is not the real intruption and if it is not then then you will receive the continue where you have to replay the buffer of the precious response

              // Like if we have sent buffer to the twilio and then user intrupts like user said okay but the intention was not to intrupt user said it normally like we say in a normal conversation then it is not treated as an intruption and you will receive the continue and you have to play the buffer of the previous response.

              await session.ws.send(
                JSON.stringify({
                  event: "clear",
                  streamSid: session.streamSid,
                })
              );
              break;
            // Continue is received when you have to play the buffer of the previous response
            case "continue":
              // This is the part which is pending from our side and it will be updated soon but if you can implement the logic it will be great
              break;
            // That is the actual case to clear all the buffer which was sent to twilio from now the buffer the new query will be received
            case "clear":
              console.log({ type, msg });
              const intrupt_msg = {
                event: "clear",
                streamSid: session.streamSid,
              };
              await session.ws.send(JSON.stringify(intrupt_msg));
              break;
            // Speakr connection ended
            case "end":
              console.log({ type, msg });
              break;
            // Buffer is received from the speakr encoded with base64
            case "media":
              const message = Buffer.from(msg, "base64");
              const metadataEndIndex = message.indexOf(0);
              const metadataString = message
                .slice(0, metadataEndIndex)
                .toString("utf-8");
              const bufferWithoutMetadata = message.slice(metadataEndIndex + 1);
              try {
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
                await session.ws.send(JSON.stringify(mediaMessage));
                const markMessage = {
                  event: "mark",
                  streamSid: session.streamSid,
                  mark: {
                    name: `${sequence_id}session_id${session_id}`,
                  },
                };
                try {
                  await session.ws.send(JSON.stringify(markMessage));
                } catch (err) {
                  console.log("Error in sending mark message.");
                }
              } catch (error) {
                console.log("Erorr in getting sessio_id : ", error);
              }
              break;
            default:
              console.log("Type not handled");
              break;
          }
        } catch (error) {
          console.log("Error in speakr websocket");
        }
      });

      session.speakrws.on("error", (error) => {
        console.log(`TTS WebSocket error: ${error.message}`);
      });

      session.speakrws.on("close", (code, reason) => {
        console.log(`TTS WebSocket closed. Code: ${code}, Reason: ${reason}`);
      });
    };
    connectTospeakr(session);
  } catch (err) {
    console.log("Error in making cartesia websocket connection. : ", err);
    ws.close();
  }
  console.log("TTS Connection Successfull.");
  session.ws = ws;

  // These are the events which are received from the twilio websocket
  ws.on("message", async (message) => {
    const msg = JSON.parse(message);
    switch (msg.event) {
      case "connected":
        console.log("Twilio media stream connected");
        break;
      case "start":
        if (msg.start.streamSid) {
          session.streamSid = msg.start.streamSid;
          session.callSid = msg.start.callSid;
        }
        console.log("Twilio media stream started");
        break;
      case "dtmf":
        console.log("Twilio recived dtmf");
        break;
      case "mark":
        // You have to extract the session_id and the sequence_id which we have sent to twilio with the buffer
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
          session.speakrws.send(
            JSON.stringify({
              type: "status",
              msg: {
                session_id: session_id,
                sequence_id: sequence_id,
              },
            })
          );
        } else {
          console.log("No file number found after 'detectfilenumber'.");
        }
        break;
      case "media":
        // Send the media to speakr only if the speakr connection is open and you have received ready from speakr
        if (
          session.cansendtospeakr &&
          session.speakrws.readyState === session.speakrws.OPEN
        ) {
          const buffer = Buffer.from(msg.media.payload, "base64");
          decodeAndSendMulawChunks(buffer, session);
        }
        break;
      case "stop":
        console.info("Twilio media stream stopped");
        break;
    }
  });
  ws.on("close", async () => {
    console.log("Twilio websocket closed.");
    if (session.speakrws.readyState === WebSocket.OPEN) {
      session.speakrws.close();
    }
  });
};

module.exports = { handleRealTimeStream };

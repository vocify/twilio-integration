require("dotenv").config({ path: "./config.env" });

const speakr_api_key = process.env.SPEAKRKEY;
const speakr_websocket_url = process.env.SPEAKRWEBSOCKET;

module.exports = {speakr_api_key , speakr_websocket_url}
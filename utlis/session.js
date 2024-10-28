class Session {
  constructor() {
    this.streamSid = "";
    this.callSid = "";
    this.ws = null;
    this.speakrws = null;
    this.cansendtospeakr = false;
  }
}

module.exports = Session;

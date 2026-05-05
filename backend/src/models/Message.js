const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, index: true },
  sender: { type: String, required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  // optional: store sentiment and other metadata
  meta: { type: Object, default: {} }
});

module.exports = mongoose.model('Message', MessageSchema);

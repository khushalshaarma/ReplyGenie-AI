const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  _id: { type: String }, // use a string id (e.g. room id)
  participants: { type: [String], default: [] },
  summary: { type: String, default: '' },
  lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Conversation', ConversationSchema);

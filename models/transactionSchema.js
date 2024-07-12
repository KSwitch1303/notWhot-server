const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  party1: {
    type: String,
    required: true
  },
  party2: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    default: 'pending'
  },
  detail: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction
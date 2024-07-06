const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true
  },
  bank: {
    type: String,
    required: true
  },
  accountNo: {
    type: String,
    required: true
  },
  accountName: {
    type: String,
    required: true
  },
  balance: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
module.exports = User
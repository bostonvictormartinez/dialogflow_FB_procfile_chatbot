'use strict';
const request = require('request');
const crypto = require('crypto');
const config = require('../config');
module.exports = {


    handleMessages: function(messages, sender){
        let self = module.exports;
        let timeoutInterval = 1100;
        let previousType ;
        let cardTypes = [];
        let timeout = 0;
        for (var i = 0; i < messages.length; i++) {

            if ( previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
                timeout = (i - 1) * timeoutInterval;
                setTimeout(self.handleCardMessages.bind(null, cardTypes, sender), timeout);
                cardTypes = [];
                timeout = i * timeoutInterval;
                setTimeout(self.handleMessage.bind(null, messages[i], sender), timeout);
            } else if ( messages[i].message == "card" && i == messages.length - 1) {
                cardTypes.push(messages[i]);
                timeout = (i - 1) * timeoutInterval;
                setTimeout(self.handleCardMessages.bind(null, cardTypes, sender), timeout);
                cardTypes = [];
            } else if ( messages[i].message == "card") {
                cardTypes.push(messages[i]);
            } else  {

                timeout = i * timeoutInterval;
                setTimeout(self.handleMessage.bind(null, messages[i], sender), timeout);
            }

            previousType = messages[i].message;

        }
    },

   



    sendTextMessage: function(recipientId, text) {
        let self = module.exports;
        var messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                text: text
            }
        }
        self.callSendAPI(messageData);
    },


    /*
     * Call the Send API. The message data goes in the body. If successful, we'll
     * get the message id in a response
     *
     */
    callSendAPI: function(messageData) {
        request({
            uri: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: config.FB_PAGE_TOKEN
            },
            method: 'POST',
            json: messageData

        }, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var recipientId = body.recipient_id;
                var messageId = body.message_id;

                if (messageId) {
                    console.log("Successfully sent message with id %s to recipient %s",
                        messageId, recipientId);
                } else {
                    console.log("Successfully called Send API for recipient %s",
                        recipientId);
                }
            } else {
                console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
            }
        });
    },

    isDefined: function(obj) {
        if (typeof obj == 'undefined') {
            return false;
        }

        if (!obj) {
            return false;
        }

        return obj != null;
    }

} 
'use strict';

const dialogflow = require('dialogflow');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const pg=require('pg');
const app = express();
const uuid = require('uuid');

pg.defaults.ssl=true;

const broadcast = require('./routes/broadcast');


const passport=require('passport');
const FacebookStrategy=require('passport-facebook').Strategy;
const session =require ('express-session');

const userService=require('./user'); //this is added first step v2p2 lighten code load
const colors=require('./colors'); //v2p2 add colorsjs also added case:iphone_colors
// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
    throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
    throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.GOOGLE_PROJECT_ID) {
    throw new Error('missing GOOGLE_PROJECT_ID');
}
if (!config.DF_LANGUAGE_CODE) {
    throw new Error('missing DF_LANGUAGE_CODE');
}
if (!config.GOOGLE_CLIENT_EMAIL) {
    throw new Error('missing GOOGLE_CLIENT_EMAIL');
}
if (!config.GOOGLE_PRIVATE_KEY) {
    throw new Error('missing GOOGLE_PRIVATE_KEY');
}
if (!config.FB_APP_SECRET) {
    throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
    throw new Error('missing SERVER_URL');
}

if (!config.SENDGRID_API_KEY) {
    throw new Error('missing SENDGRID_API_KEY');
}
if (!config.EMAIL_FROM) {
    throw new Error('missing EMAIL_FROM');
}
if (!config.EMAIL_TO) {
    throw new Error('missing EMAIL_TO');
}
if (!config.PG_CONFIG) {
    throw new Error('missing PG_CONFIG');
}
if (!config.WEATHER_API_KEY) {
    throw new Error('missing WEATHER_API_KEY');
}
if(!config.FB_APP_ID){
    throw new Error('missing FB_APP_ID');
}

//if(!config.ADMIN_ID){
  //  throw new Error('missing ADMIN_ID');
//}

app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
    verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
    extended: false
}));

// Process application/json
app.use(bodyParser.json());

app.use(session(
    {
        secret: 'keyboard cat',
        resave: true,
        saveUninitilized: true
    }
));


app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser(function(profile, cb) {
    cb(null, profile);
});

passport.deserializeUser(function(profile, cb) {
    cb(null, profile);
});

passport.use(new FacebookStrategy({
        clientID: config.FB_APP_ID,
        clientSecret: config.FB_APP_SECRET,
        callbackURL: config.SERVER_URL + "auth/facebook/callback"
    },
    function(accessToken, refreshToken, profile, cb) {
        process.nextTick(function() {
            return cb(null, profile);
        });
    }
));

app.get('/auth/facebook', passport.authenticate('facebook',{scope:'public_profile'}));


app.get('/auth/facebook/callback',
    passport.authenticate('facebook', { successRedirect : '/broadcast/broadcast', failureRedirect: '/broadcast' }));

app.set('view engine','ejs');



const credentials = {
    client_email: config.GOOGLE_CLIENT_EMAIL,
    private_key: config.GOOGLE_PRIVATE_KEY,
};

const sessionClient = new dialogflow.SessionsClient(
    {
        projectId: config.GOOGLE_PROJECT_ID,
        credentials
    }
);


const sessionIds = new Map();
const usersMap = new Map(); //this is for adding user globally in v2

// Index route
app.get('/', function (req, res) {
    res.send('Hello world, I am a chat bot for you')
})


app.use('/broadcast', broadcast);


// for Facebook verification
app.get('/webhook/', function (req, res) {
    console.log("request");
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 */
app.post('/webhook/', function (req, res) {
    var data = req.body;
    console.log(JSON.stringify(data));
    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function (messagingEvent) {
                if (messagingEvent.optin) {
                    receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else if (messagingEvent.read) {
                    receivedMessageRead(messagingEvent);
                } else if (messagingEvent.account_linking) {
                    receivedAccountLink(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        // You must send back a 200, within 20 seconds
        res.sendStatus(200);
    }
});



//this is added to set userId to global and passes sender ID once we test below in opening response
function setSessionAndUser(senderID){
    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }
    if(!usersMap.has(senderID)){
        userService.addUser(function(user){
            usersMap.set(senderID, user);
        }, senderID);
    }
}
//now to setSessionAndUser by replacing if(!sessionIds.has(senderID)) below with function setSessionAndUser

function receivedMessage(event) {

    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    //if (!sessionIds.has(senderID)) {
      //  sessionIds.set(senderID, uuid.v1());
    //}
//is now just
setSessionAndUser(senderID);

//now add setSessionAndUser in Postback because it is global



    //console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
    //console.log(JSON.stringify(message));

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
        handleEcho(messageId, appId, metadata);
        return;
    } else if (quickReply) {
        handleQuickReply(senderID, quickReply, messageId);
        return;
    }


    if (messageText) {
        //send message to api.ai
        sendToDialogFlow(senderID, messageText);
    } else if (messageAttachments) {
        handleMessageAttachments(messageAttachments, senderID);
    }
}


function handleMessageAttachments(messageAttachments, senderID) {
    //for now just reply
    sendTextMessage(senderID, "Attachment received. Thank you for attachment.");
}

function handleQuickReply(senderID, quickReply, messageId) {
    //add switch v2p3
    var quickReplyPayload = quickReply.payload;

    switch(quickReplyPayload){
        case 'NEWS_PER_WEEK':
            userService.newsletterSettings(function(updated){
                if(updated){
                    sendTextMessage(senderID, "Thanks for subscribing, say unsubscribe anytime.");
                }else{
                    sendTextMessage(senderID, "Newsletter broken. Try again later.");
                }
            }, 1, senderID);
            break;
            case 'NEWS_PER_DAY':
                userService.newsletterSettings(function(updated){
                    if(updated){
                        sendTextMessage(senderID, "Thank you for subscribing, say unsubscribe anytime.");
                    }else{
                        sendTextMessage(senderID, "Newsletter broken, try again later.");
                    }
                }, 2, senderID);
                break;
                default:
                  sendTextMessage(sessionIds, handleDialogFlowResponse, senderID, quickReplyPayload);
                
                
    }
  //  var quickReplyPayload = quickReply.payload;
   // console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
    //send payload to api.ai
   // sendToDialogFlow(senderID, quickReplyPayload); change this section v2p3 
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

function handleDialogFlowAction(sender, action, messages, contexts, parameters) {
    switch (action) {
        case "unsubscribe":
            userService.newsletterSettings(function(updated){
                if(updated){
                    sendTextMessage(sender, 'unsubscribe');
                }else{
                    sendTextMessage(sender, 'not working');
                }
            }, 0, sender);
            break;
        case "buy.iphone":
	colors.readUserColor(function(color) {
		let reply;
		if (color === '') {
			reply = 'In what color would you like to have it?';
		} else {
			reply = `Would you like to order it in your favourite color ${color}?`;
		}
		sendTextMessage(sender, reply);

	}, sender
)
break;

        case "iphone_colors.favorite":
            colors.updateUserColor(parameters.fields['color'].stringValue, sender);
            let reply="I like it and will remember.";
            sendTextMessage(sender, reply);
            break;
        case "iphone_colors":
            colors.readAllColors(function(allColors){
                let allColorsString=allColors.join(', '); 
                //this is string to read all colors back
                let reply = `Iphone xxx is available in ${allColorsString}. what now there is your favorite color?`;
                sendTextMessage(sender, reply);
            });
            break;
        case "get-current-weather":
        	if ( parameters.fields.hasOwnProperty('geo-city') && parameters.fields['geo-city'].stringValue!='') {
            	request({
					url: 'http://api.openweathermap.org/data/2.5/weather', //URL to hit
                	qs: {
                		appid: config.WEATHER_API_KEY,
						q: parameters.fields['geo-city'].stringValue
                    },
                     //Query string data
            	}, function(error, response, body){
					if( response.statusCode === 200) {

                    	let weather = JSON.parse(body);
                    	if (weather.hasOwnProperty("weather")) {
                            let reply = `${messages[0].text.text} ${weather["weather"][0]["description"]}`;
                        	sendTextMessage(sender, reply);
                    	} else {
                        	sendTextMessage(sender,
								`Not a weather forecast available for ${parameters.fields['geo-city'].stringValue}`);
                        }
                    } else {
						sendTextMessage(sender, 'Weather forecast is not available');
                    }
                });
            } else {
            	handleMessages(messages, sender);
            }
            break;
        case "faq-delivery":

            handleMessages(messages, sender);
            sendTypingOn(sender);

            //ask user what next
            setTimeout(function () {
                let buttons = [
                    {
                        type: "web_url",
                        url: "https://google.com",
                        title: "sample"
                    },
                    {
                        type: "phone_number",
                        title: "Call",
                        payload: "+16175044426"
                    },
                    {
                        type: "postback",
                        title: "Chat",
                        payload: "CHAT"
                    }
                ];

                sendButtonMessage(sender, "what next?", buttons);
            }, 3000)
            break;
        case "mobility3_action":
            let filteredContexts = contexts.filter(function (el) {
                return el.name.includes('mobility2_context') ||
                    el.name.includes('mobility3_intent_dialog_context')
            });

            if (filteredContexts.length > 0 && contexts[0].parameters) {
                let phone_number = (isDefined(contexts[0].parameters.fields['phone'])
                    && contexts[0].parameters.fields['phone'] != '') ? contexts[0].parameters.fields['phone'].stringValue : '';

                let user_name = (isDefined(contexts[0].parameters.fields['user_name'])
                    && contexts[0].parameters.fields['user_name'] != '') ? contexts[0].parameters.fields['user_name'].stringValue : '';

                let steps = (isDefined(contexts[0].parameters.fields['steps'])
                    && contexts[0].parameters.fields['steps'] != '') ? contexts[0].parameters.fields['steps'].stringValue : '';


                // if(phone_number != '' && user_name != ''
                //if(phone_number==    

                if (phone_number != '' && user_name != '' && steps == '') {
                    let replies = [
                        {
                            "content_type": "text",
                            "title": "less 1000",
                            "payload": "less 1000"
                        },
                        {
                            "content_type": "text",
                            "title": "more 1000",
                            "payload": "more 1000"
                        },
                        {
                            "content_type": "text",
                            "title": "more 10000",
                            "payload": "more 10000"
                        }
                    ];
                    sendQuickReply(sender, messages[0].text.text[0], replies);
                } else if (phone_number != '' && user_name != '' && steps != '') {
                    let emailContent = 'a new email' + user_name + 'for item: ' + phone_number + ' ' + steps + '.';
                    sendEmail('new application', emailContent);

                    var pool=new pg.Pool(config.PG_CONFIG);
                    pool.connect(function(err, client, done){
                        if(err){
                            return console.error('error acquiring', err.stack);
                        }
                        client
                            .query(
                                'INSERT into mobility_applications'+ '(user_name, phone_number, steps)'+'VALUES($1, $2, $3) RETURNING id', [user_name, phone_number, steps],
                                function(err,result){
                                    if(err){
                                    console.log(err);
                                }else{
                                    console.log('row inserted' + result.rows[0].id);
                                }
                             });
                    });
                    pool.end();
                    handleMessages(messages, sender);
                } else {
                    handleMessages(messages, sender);
                }
            }
            break;
        default:
            //unhandled action, just send back the text
            handleMessages(messages, sender);
    }
}

function handleMessage(message, sender) {
    switch (message.message) {
        case "text": //text
            message.text.text.forEach((text) => {
                if (text !== '') {
                    sendTextMessage(sender, text);
                }
            });
            break;
        case "quickReplies": //quick replies
            let replies = [];
            message.quickReplies.quickReplies.forEach((text) => {
                let reply =
                {
                    "content_type": "text",
                    "title": text,
                    "payload": text
                }
                replies.push(reply);
            });
            sendQuickReply(sender, message.quickReplies.title, replies);
            break;
        case "image": //image
            sendImageMessage(sender, message.image.imageUri);
            break;
    }
}


function handleCardMessages(messages, sender) {

    let elements = [];
    for (var m = 0; m < messages.length; m++) {
        let message = messages[m];
        let buttons = [];
        for (var b = 0; b < message.card.buttons.length; b++) {
            let isLink = (message.card.buttons[b].postback.substring(0, 4) === 'http');
            let button;
            if (isLink) {
                button = {
                    "type": "web_url",
                    "title": message.card.buttons[b].text,
                    "url": message.card.buttons[b].postback
                }
            } else {
                button = {
                    "type": "postback",
                    "title": message.card.buttons[b].text,
                    "payload": message.card.buttons[b].postback
                }
            }
            buttons.push(button);
        }


        let element = {
            "title": message.card.title,
            "image_url": message.card.imageUri,
            "subtitle": message.card.subtitle,
            "buttons": buttons
        };
        elements.push(element);
    }
    sendGenericMessage(sender, elements);
}


function handleMessages(messages, sender) {
    let timeoutInterval = 1100;
    let previousType;
    let cardTypes = [];
    let timeout = 0;
    for (var i = 0; i < messages.length; i++) {

        if (previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
        } else if (messages[i].message == "card" && i == messages.length - 1) {
            cardTypes.push(messages[i]);
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
        } else if (messages[i].message == "card") {
            cardTypes.push(messages[i]);
        } else {

            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
        }

        previousType = messages[i].message;

    }
}

function handleDialogFlowResponse(sender, response) {
    let responseText = response.fulfillmentMessages.fulfillmentText;

    let messages = response.fulfillmentMessages;
    let action = response.action;
    let contexts = response.outputContexts;
    let parameters = response.parameters;

    sendTypingOff(sender);

    if (isDefined(action)) {
        handleDialogFlowAction(sender, action, messages, contexts, parameters);
    } else if (isDefined(messages)) {
        handleMessages(messages, sender);
    } else if (responseText == '' && !isDefined(action)) {
        //dialogflow could not evaluate input.
        sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
    } else if (isDefined(responseText)) {
        sendTextMessage(sender, responseText);
    }
}

async function sendToDialogFlow(sender, textString, params) {

    sendTypingOn(sender);

    try {
        const sessionPath = sessionClient.sessionPath(
            config.GOOGLE_PROJECT_ID,
            sessionIds.get(sender)
        );

        const request = {
            session: sessionPath,
            queryInput: {
                text: {
                    text: textString,
                    languageCode: config.DF_LANGUAGE_CODE,
                },
            },
            queryParams: {
                payload: {
                    data: params
                }
            }
        };
        const responses = await sessionClient.detectIntent(request);

        const result = responses[0].queryResult;
        handleDialogFlowResponse(sender, result);
    } catch (e) {
        console.log('error');
        console.log(e);
    }

}


function sendTextMessage(recipientId, text) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text
        }
    }
    callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: config.SERVER_URL + "/assets/instagram_logo.gif"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "audio",
                payload: {
                    url: config.SERVER_URL + "/assets/sample.mp3"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "video",
                payload: {
                    url: config.SERVER_URL + videoName
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "file",
                payload: {
                    url: config.SERVER_URL + fileName
                }
            }
        }
    };

    callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: text,
                    buttons: buttons
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: elements
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
    timestamp, elements, address, summary, adjustments) {
    // Generate a random receipt ID as the API requires a unique ID
    var receiptId = "order" + Math.floor(Math.random() * 1000);

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "receipt",
                    recipient_name: recipient_name,
                    order_number: receiptId,
                    currency: currency,
                    payment_method: payment_method,
                    timestamp: timestamp,
                    elements: elements,
                    address: address,
                    summary: summary,
                    adjustments: adjustments
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text,
            metadata: isDefined(metadata) ? metadata : '',
            quick_replies: replies
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "mark_seen"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_on"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_off"
    };

    callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Welcome. Link your account.",
                    buttons: [{
                        type: "account_link",
                        url: config.SERVER_URL + "/authorize"
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}

async function resolveAfterXSeconds(x){ //add this for v2p2 resolve user greet
    return new Promise (resolve=>{
        setTimeout(()=>{
            resolve(x);
        }, x * 1000);
    });
}

async function greetUserText(userID){
    let user= usersMap.get(userID);
    //add this too resolve
    if(!user){
        await resolveAfterXSeconds(2);
        users=usersMap.get(userID);
    }
    if(user){
        sendTextMessage(userID, "Hello there you " + user.first_name + "How can I help you?");
    }else{
        sendTextMessage(userID, "Hello there you " + user.first_name + "How can I help you?");

    }

}

function sendFunNewsSubscribe(userId){
    let responseText="I can send updates, how often? once a week or daily?";
    let replies=[
        {
            "content_type":"text",
            "title":"weekly",
            "payload":"NEWS_PER_WEEK"
        },
        {
            "content_type":"text",
            "title":"daily",
            "payload":"NEWS_PER_DAY"
        }
    ];
    sendQuickReply(userId, responseText, replies);
}


/*  take this function out moved to user.js for greetusertext and is
now add above function

function greetUserText(userId){
    request({
        uri:'https://graph.facebook.com/v3.2/' + userId,
        qs:{
            access_token: config.FB_PAGE_TOKEN
        }
    },
    function(error,response, body){
        if (!error && response.statusCode==200){
            var user=JSON.parse(body);
            if(user.first_name){
                var pool = new pg.Pool(config.PG_CONFIG);
                pool.connect(function(err, client, done) {
                    if (err) {
                        return console.error('Error acquiring client', err.stack);
                    }
                    var rows = [];
                    client.query(`SELECT fb_id FROM users WHERE fb_id='${userId}' LIMIT 1`,
                        function(err, result) {
                            if (err) {
                                console.log('Query error: ' + err);
                            } else {

                                if (result.rows.length === 0) {
                                    let sql = 'INSERT INTO users (fb_id, first_name, last_name, profile_pic) ' +
										'VALUES ($1, $2, $3, $4)';
                                    client.query(sql,
                                        [
                                            userId,
                                            user.first_name,
                                            user.last_name,
                                            user.profile_pic
                                        ]);
                                }
                            }
                        });

                });
                pool.end();
                sendTextMessage(userId, "welcome"+ user.first_name + '!' + "how can I help") ;
            }else{
                console.log('cannot get data', userId);
            }
        }else{
            console.error(response.error);
        }
    });
}*/

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
    request({
        uri: 'https://graph.facebook.com/v3.2/me/messages',
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
                console.log("Successfully sent message with id %s to recipient %s", messageId, recipientId);
            } else {
                console.log("Successfully called Send API for recipient %s", recipientId);
            }
        } else {
            console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
        }
    });
}



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    setSessionAndUser(senderID); //this is added in v2 which call global userID not just in opening

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload;

    switch (payload) {
        case "FUN_NEWS":
            sendFunNewsSubscribe(senderID);
            break;

        case "GET_STARTED":
            greetUserText(senderID);
            break;


        case "JOB_APPLY":
            sendToDialogFlow(senderID, 'mobility items');
            break;

        case "CHAT":
            sendTextMessage(senderID, "I love chat any other questions?");
            break;

        default:
            //unindentified payload
            sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
            break;

    }

    console.log("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
        "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    var status = event.account_linking.status;
    var authCode = event.account_linking.authorization_code;

    console.log("Received account link event with for user %d with status %s " +
        "and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
        messageIDs.forEach(function (messageID) {
            console.log("Received delivery confirmation for message ID: %s",
                messageID);
        });
    }

    console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger'
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
        "through param '%s' at %d", senderID, recipientID, passThroughParam,
        timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
        throw new Error('Couldn\'t validate the signature.');
    } else {
        var elements = signature.split('=');
        var method = elements[0];
        var signatureHash = elements[1];

        var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
            .update(buf)
            .digest('hex');

        if (signatureHash != expectedHash) {
            throw new Error("Couldn't validate the request signature.");
        }
    }
}

function sendEmail(subject, content) {
    console.log('sending email');
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(config.SENDGRID_API_KEY);

    const msg = {
        to: config.EMAIL_TO,
        from: config.EMAIL_FROM,
        subject: subject,
        text: content,
        html: content,
    };
    sgMail.send(msg)
        .then(() => {
            console.log('email sent');
        })

        .catch(error => {
            console.log('email not sent');
            console.log(error.toString());
        });
}


function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}


// Spin up the server
app.listen(app.get('port'), function () {
    console.log('running on port', app.get('port'))
})

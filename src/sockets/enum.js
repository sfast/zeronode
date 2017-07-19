/**
 * Created by artak on 2/15/17.
 */

export default {
    EnvelopType: {
        ASYNC  : 1,
        SYNC : 2,
        RESPONSE  :3,
        PROXY : 4
    },
    SEND_TICK: 'sendTick',
    SEND_REQUEST: 'sendRequest',
    GOT_TICK: 'gotTick',
    GOT_REQUEST: 'gotRequest',
    GOT_REPLY: 'gotReply',
    REQUEST_TIMEOUT: 'requestTimeout'
};

/**
 * Created by root on 7/11/17.
 */
export class ConnectionError extends Error {
    constructor({err, id, state = 'connecting'}) {
        super(err);
        this.id = id;
        this.state = state;
    }
}

export class BindError extends Error {
    constructor({id, err, state = 'binding'}) {
        super(err);
        this.id = id;
        this.state = state;
    }
}
### About
Every message in zeronode is encrypted byte array, which contains information
about sender, receiver, message data, event, etc.


### Structure
1. First byte of envelop is describing if message is zeronode internal event,
or custom event ( 1 if internal, 0 if custom )
2. Next 1 byte is information about envelop **type** (tick: 1, request: 2, response: 3, error: 4) (int8).
3. Next bytes are envelop **id**.
    1. First 1 byte are **length** of id.
    2. Next **length** of bytes are **id** (hex encoded).
4. Next bytes are sender information.
    1. First 1 byte are **length** of sender id.
    2. Next **length** of bytes are **id** of sender (utf-8 encoded).
5. Next bytes are receiver information.
    1. First 1 byte are **length** of receiver id.
    2. Next **length** of bytes are **id** of receiver (utf-8 encoded).
6. Next bytes are **event** name.
    1. First 1 byte are **length** of **event** name.
    2. Next **length** of bytes are **event** name (utf-8 encoded).
7. Remaining bytes are message data JSON stringified.


<br>
<br>
<br>
<br>

<table><tbody>
<tr><td></td><td>isInternal</td><td>type</td><td>id_length</td><td>id</td><td>sender_length</td><td>sender</td><td>receiver_length</td><td>receiver</td><td>event_length</td><td>event</td><td>data</td></tr>
<tr><td>type</td><td>Bool</td><td>Int8</td><td>int8</td><td>hex</td><td>int8</td><td>utf-8</td><td>int8</td><td>utf-8</td><td>int8</td><td>utf-8</td><td>JSON</td></tr>
<tr><td>length (bytes)</td><td>1<td>1</td><td>1</td><td>id_length</td><td>1</td><td>sender_length</td><td>1</td><td>receiver_length</td><td>1</td><td>event_length</td><td>remaining</td></tr>
</tbody></table>
<br/>

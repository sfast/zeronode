### About
Every message in zeronode is encrypted byte array, which contains information
about sender node, receiver node, message data, event, etc...

### Structure
<br/>

<table><tbody>
<tr>
    <td></td><td>is_internal</td>
    <td>event_type</td>
    <td>id_length</td>
    <td>id</td>
    <td>sender_length</td>
    <td>sender id</td>
    <td>receiver_length</td>
    <td>receiver id</td>
    <td>event_length</td>
    <td>event</td>
    <td>data</td>
</tr>
<tr>
    <td>Type</td>
    <td>bool</td>
    <td>int8</td>
    <td>int8</td>
    <td>hex</td>
    <td>int8</td>
    <td>utf-8</td>
    <td>int8</td>
    <td>utf-8</td>
    <td>int8</td>
    <td>utf-8</td>
    <td>JSON</td>
</tr>
<tr>
    <td>length (bytes)</td>
    <td>1<td>1</td>
    <td>1</td>
    <td>id_length</td>
    <td>1</td>
    <td>sender_length</td>
    <td>1</td>
    <td>receiver_length</td>
    <td>1</td>
    <td>event_length</td>
    <td>remaining</td>
</tr>
</tbody></table>
<br/>
<br/>
<br/>

1. First byte of envelop is describing if message is zeronode's internal event or a custom event - 1 is internal event, 0 is custom event.
2. Next 1 byte (**Int8**) is holding the information about envelop **type** - 1 is tick, 2 is request, 3 is response, 4 is error.
3. Next bytes are defining the envelop **id**.
    1. First 1 byte is **Int8** and it's value contains the **length** of bytes after it holding envelop id.
    2. Next **length** of bytes hold the **id** of envelop which is **hex** encoded.
4. Next bytes are defining the sender node id.
    1. Frst 1 byte is **Int8** and it's value contains the **length** of bytes after it holding sender id.
    2. Next **length** of bytes hold the **id** of sender node, which is **utf-8** encoded.
5. Next bytes are defining the receiver node id.
    1. Frst 1 byte is **Int8** and it's value contains the **length** of bytes after it holding receiver id.
    2. Next **length** of bytes hold the **id** of receiver node, which is **utf-8** encoded.
6. Next bytes are defining the **event** name.
    1. Frst 1 byte is **Int8** and it's value contains the **length** of bytes after it holding event name.
    2. Next **length** of bytes hold the **event** name in **utf-8** encoded format.
7. Remaining bytes are the message data in JSON stringified format.

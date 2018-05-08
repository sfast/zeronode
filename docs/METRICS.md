### About
Metrics in Zeronode is for collecting information about performance and data traffic.

### How to use
Enabling metrics is very simple.
```javascript
let node = new Node()
node.enableMetrics(flushInterval) //flushInterval is interval for udating aggregation table
```
When metrics is enabled, then node will start collecting information about every tick and request.
It will collect data about request fail, timeout, latency, size and so on.
After flushInterval it will aggregate all collected information into one table with event and nodeId and with custom defined column.

After enabling Metrics, you can query and get information
```javascript
node.metric.getMetrics(query)
/*
  query is loki.js query object. Query is performed on aggregation table.
*/
```

### stored Data
There are three tables stored in loki.js: Request, Tick, Aggregation.
<br>
All Ticks in flushInterval are stored in Tick table, stored data is
```javascript
Tick: {
  id: hex, // id of tick
  event: String, // event name
  from: String, // node id that emits event
  to: String, // node id that handles event
  size: Number // size of message in bytes
}
```

All requests in flushInterval are stored in Request table, stored data is
```javascript
Request: {
  id: hex, // id of request
  event: String, // event name
  from: String, // node id that makes request
  to: String, // node id that handles request
  size: Array[Number,Number], // size of request, and reply 
  timeout: Boolean, // is request timeouted
  duration: Object {latency, process}, // time passed in nanoseconds for handling request
  success: Boolean // is request succeed ,
  error: Boolean // is request failed
}
```

All aggregations are stored in Aggregation table. 
```javascript
// request aggregations
{
    node: String, //id of node
    event: String, // event name
    out: Boolean, // request sent or received 
    request: true, // is request or tick,
    latency: Number, // average latency in nanoseconds
    process: Number, // averahe process time in nanoseconds
    count: Number, // count of requests
    success: Number, // count of succed requests
    error: Number, // count of failed requests
    timeout: Number, // caount of timeouted requests
    size: Number // average size of request
    customField // custom defined field
  }
  
// tick aggregations
{
  node: String, //id of node
  event: String, // event name
  out: Boolean, // tick sent or received 
  request: false, // is request or tick
  count: Number, // count of ticks
  size: Number // average size of tick
}
```

### How to define column
You can define custom column in aggregation table, for collecting specific metrics.
```javascript
node.metricdefineColumn (columnName: String, initialValue, reducer: function, isIndex: Boolean)
/*
columenName: is name of column.
initialvalue:  is initial value of column, used in reducer.
reducer: function that called for updating column.
isIndex: is column indexed in loki.js (indexed columns are faster when making queries)

reducers first parameter is row, second parameter is requesy/tick record.
*/

```


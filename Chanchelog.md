Version: 1.1.0 (Dec 6 2017, Artak Vardanyan, David Harutyunyan)
- Breaking changes for request and tick methods and 
- CLIENT_PING_INTERVAL can be set for the client through client setOptions(options)
- Fixed onRequest() handlers ordering
- added snyk test for vulnerabilities testing 
- added zeromq monitor events

Version: 1.0.12 (Nov 17 2017, Artak Vardanyan, David Harutyunyan)
- added Buffer.aloc shim so zeronode will work also for node < 4.5.0
- added preinstall script for zeroMQ so it'll be installed automatically((works on Debian, Mac) )
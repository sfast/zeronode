Version: 1.1.6 (Feb 9 2017, Artak Vardanyan, David Harutyunyan)
- bug fix
- test coverage ~ 90%
- Readme updates
- benchmark

Version: 1.1.5 (Dec 22 2017, Artak Vardanyan, David Harutyunyan)
- test coverage ~ 70%
- bug fix
- Readme updates

Version: 1.1.4 (Dec 9 2017, Artak Vardanyan, David Harutyunyan)
- fixed a monitor bug (changed zmq package to zeromq package )
- added getClientInfo andgetServerInfo node functions which return the actor info
- all node events will emit the full actor information (online, options etc ...)
- from now on we'll tag all releases as a tagged branch to keep it transparent the changes between version

Version: 1.1.0 (Dec 6 2017, Artak Vardanyan, David Harutyunyan)
- Breaking changes for request and tick methods and 
- CLIENT_PING_INTERVAL can be set for the client through client setOptions(options)
- Fixed onRequest() handlers ordering
- added snyk test for vulnerabilities testing 
- added zeromq monitor events

Version: 1.0.12 (Nov 17 2017, Artak Vardanyan, David Harutyunyan)
- added Buffer.aloc shim so zeronode will work also for node < 4.5.0
- added preinstall script for zeroMQ so it'll be installed automatically((works on Debian, Mac) )
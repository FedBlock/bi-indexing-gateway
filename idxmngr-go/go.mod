module idxmngr-go

go 1.23

require (
	fileindex-go v0.0.0-00010101000000-000000000000
	github.com/gocarina/gocsv v0.0.0-20240520201108-78e41c74b4b1
	google.golang.org/grpc v1.68.1
	google.golang.org/protobuf v1.34.2
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/kr/pretty v0.3.1 // indirect
	golang.org/x/net v0.29.0 // indirect
	golang.org/x/sys v0.25.0 // indirect
	golang.org/x/text v0.18.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240903143218-8af14fe29dc1 // indirect
	gopkg.in/check.v1 v1.0.0-20190902080502-41f04d3bba15 // indirect
)


replace fileindex-go => ../fileindex-go

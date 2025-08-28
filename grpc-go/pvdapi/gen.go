// gen.go
package api

//go:generate -command compile_proto protoc -I../protos
//go:generate compile_proto pvd_hist.proto --go-grpc_out=. --go_out=.

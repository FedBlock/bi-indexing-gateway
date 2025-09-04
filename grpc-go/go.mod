module grpc-go

go 1.23.0

toolchain go1.23.7

require (
	github.com/diegoholiveira/jsonlogic/v3 v3.5.3
	github.com/fsnotify/fsnotify v1.7.0
	github.com/gocarina/gocsv v0.0.0-20240520201108-78e41c74b4b1
	github.com/goccy/go-json v0.10.2
	github.com/hyperledger/fabric-gateway v1.1.0
	github.com/hyperledger/fabric-protos-go-apiv2 v0.0.0-20220615102044-467be1c7b2e7
	github.com/spf13/viper v1.18.2
	github.com/timtadh/fs2 v0.1.0
	google.golang.org/grpc v1.68.1
	google.golang.org/protobuf v1.34.2
	grpc-go/idxmngr-go v0.0.0-00010101000000-000000000000
)

replace grpc-go/idxmngr-go => ../idxmngr-go

require (
	github.com/barkimedes/go-deepcopy v0.0.0-20220514131651-17c30cfc62df // indirect
	github.com/hashicorp/hcl v1.0.0 // indirect
	github.com/magiconair/properties v1.8.7 // indirect
	github.com/miekg/pkcs11 v1.1.1 // indirect
	github.com/mitchellh/mapstructure v1.5.0 // indirect
	github.com/pelletier/go-toml/v2 v2.1.0 // indirect
	github.com/sagikazarmark/locafero v0.4.0 // indirect
	github.com/sagikazarmark/slog-shim v0.1.0 // indirect
	github.com/sourcegraph/conc v0.3.0 // indirect
	github.com/spf13/afero v1.11.0 // indirect
	github.com/spf13/cast v1.6.0 // indirect
	github.com/spf13/pflag v1.0.5 // indirect
	github.com/subosito/gotenv v1.6.0 // indirect
	go.uber.org/atomic v1.9.0 // indirect
	go.uber.org/multierr v1.9.0 // indirect
	golang.org/x/exp v0.0.0-20230905200255-921286631fa9 // indirect
	golang.org/x/net v0.38.0 // indirect
	golang.org/x/sys v0.31.0 // indirect
	golang.org/x/text v0.23.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240903143218-8af14fe29dc1 // indirect
	gopkg.in/ini.v1 v1.67.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

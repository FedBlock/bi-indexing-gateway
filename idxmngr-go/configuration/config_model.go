package configuration

var RuntimeConf = RuntimeConfig{}

type RuntimeConfig struct {
	Profile []IndexProfile `yaml:"Profile"`
}

// Profile
type IndexProfile struct {
	IndexID   string `yaml:"indexID"`
	IndexName string `yaml:"indexName"`
	Address   string `yaml:"address"`
	FilePath  string `yaml:"filePath"`
	Field     string `yaml:"field"`
	KeySize   string `yaml:"keySize"`
	BlockNum  int32  `yaml:"blockNum"`
	TotalCnt  int32  `yaml:"totalCnt"`
}

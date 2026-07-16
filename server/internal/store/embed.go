package store

import _ "embed"

//go:embed seed/songs.json
var seedSongs []byte

//go:embed seed/statements.json
var seedStatements []byte

//go:embed seed/alias.json
var seedAlias []byte

//go:embed seed/crocodile.json
var seedCrocodile []byte

package utility

import (
	"crypto/md5"
	"encoding/hex"
)

func MD5WithSalt(s string, salt string) string {
	h := md5.New()
	h.Write([]byte(salt))
	h.Write([]byte(s))
	return hex.EncodeToString(h.Sum(nil))
}

func MD5(s string) string {
	h := md5.New()
	h.Write([]byte(s))
	return hex.EncodeToString(h.Sum(nil))
}

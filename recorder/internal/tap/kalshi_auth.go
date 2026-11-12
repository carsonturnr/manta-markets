package tap

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"
)

// KalshiAuth signs Kalshi API requests: the Ed25519 signature covers timestamp_ms + METHOD + path.
type KalshiAuth struct {
	KeyID string
	key   ed25519.PrivateKey
}

// LoadKalshiAuth reads a PKCS#8 PEM Ed25519 private key.
func LoadKalshiAuth(keyID, path string) (*KalshiAuth, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	blk, _ := pem.Decode(raw)
	if blk == nil {
		return nil, errors.New("kalshi key: no PEM block")
	}
	k, err := x509.ParsePKCS8PrivateKey(blk.Bytes)
	if err != nil {
		return nil, fmt.Errorf("kalshi key: %w", err)
	}
	ek, ok := k.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("kalshi key: %T, want Ed25519", k)
	}
	return &KalshiAuth{KeyID: keyID, key: ek}, nil
}

func (a *KalshiAuth) headers(method, path string) http.Header {
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	h := http.Header{}
	h.Set("KALSHI-ACCESS-KEY", a.KeyID)
	h.Set("KALSHI-ACCESS-TIMESTAMP", ts)
	h.Set("KALSHI-ACCESS-SIGNATURE", base64.StdEncoding.EncodeToString(ed25519.Sign(a.key, []byte(ts+method+path))))
	return h
}

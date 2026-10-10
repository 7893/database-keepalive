package db

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/7893/database-keepalive/internal/config"
)

func testCertificates(t *testing.T) ([]byte, *x509.Certificate) {
	t.Helper()
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true}
	// OCI's existing CA has no KeyUsage; its pinned chain must still validate.
	raw, e := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	ca, e = x509.ParseCertificate(raw)
	if e != nil {
		t.Fatal(e)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), DNSNames: []string{"private-mysql.example"}, NotBefore: ca.NotBefore, NotAfter: ca.NotAfter, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, KeyUsage: x509.KeyUsageDigitalSignature}
	cert, e := x509.CreateCertificate(rand.Reader, leaf, ca, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	parsed, e := x509.ParseCertificate(cert)
	if e != nil {
		t.Fatal(e)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw}), parsed
}
func TestMySQLTunnelTLSAlwaysChecksChain(t *testing.T) {
	ca, leaf := testCertificates(t)
	path := filepath.Join(t.TempDir(), "ca.pem")
	if e := os.WriteFile(path, ca, 0600); e != nil {
		t.Fatal(e)
	}
	c := config.Config{Env: map[string]string{"MYSQL_SSL_CA": path, "MYSQL_HOST": "127.0.0.1", "MYSQL_SSL_VERIFY_IDENTITY": "false"}}
	transport, e := mysqlTLS(c)
	if e != nil {
		t.Fatal(e)
	}
	if transport.MinVersion != tls.VersionTLS12 || transport.VerifyConnection == nil {
		t.Fatal("missing TLS verification")
	}
	state := tls.ConnectionState{PeerCertificates: []*x509.Certificate{leaf}}
	if e := transport.VerifyConnection(state); e != nil {
		t.Fatal("valid pinned chain rejected:", e)
	}
	_, other := testCertificates(t)
	if e := transport.VerifyConnection(tls.ConnectionState{PeerCertificates: []*x509.Certificate{other}}); e == nil {
		t.Fatal("untrusted chain accepted")
	}
	if e := transport.VerifyConnection(tls.ConnectionState{}); e == nil {
		t.Fatal("missing certificate accepted")
	}
	c.Env["MYSQL_SSL_VERIFY_IDENTITY"] = "true"
	identity, e := mysqlTLS(c)
	if e != nil {
		t.Fatal(e)
	}
	if identity.InsecureSkipVerify || identity.ServerName != "127.0.0.1" {
		t.Fatal("hostname check disabled")
	}
	if _, e := leaf.Verify(x509.VerifyOptions{Roots: identity.RootCAs, DNSName: identity.ServerName}); e == nil {
		t.Fatal("mismatched identity accepted")
	}
}

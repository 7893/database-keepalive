package runtime

import (
	"errors"
	"io"
	"net"
	"os"
	"os/exec"

	"github.com/7893/database-keepalive/internal/config"
)

func prepareCertificates(c config.Config) error {
	for _, s := range c.Services() {
		if s.Type != "mysql" {
			continue
		}
		d := c.Connection(s)
		if d.Get("MYSQL_CA_PEM") == "" {
			continue
		}
		if e := os.WriteFile(d.Get("MYSQL_SSL_CA"), []byte(d.Get("MYSQL_CA_PEM")), 0600); e != nil {
			return errors.New("unable to write mysql CA")
		}
		if e := os.Chmod(d.Get("MYSQL_SSL_CA"), 0600); e != nil {
			return errors.New("unable to protect mysql CA")
		}
	}
	return nil
}

// A nil channel leaves direct connections independent of cloudflared.
func startTunnels(c config.Config) (<-chan error, func(), error) {
	children := []*exec.Cmd{}
	exit := make(chan error, 1)
	stop := func() {
		for _, child := range children {
			child.Process.Kill()
		}
	}
	for _, s := range c.Services() {
		if s.TunnelPrefix == "" {
			continue
		}
		d := c.Connection(s)
		child := exec.Command("cloudflared", "access", "tcp", "--hostname", d.Get("TUNNEL_SERVICE_HOSTNAME"), "--url", net.JoinHostPort(d.Get("MYSQL_HOST"), d.Get("MYSQL_PORT")))
		child.Env = os.Environ()
		for _, key := range []string{"TUNNEL_SERVICE_TOKEN_ID", "TUNNEL_SERVICE_TOKEN_SECRET"} {
			child.Env = append(child.Env, key+"="+d.Get(key))
		}
		child.Stdout = io.Discard
		child.Stderr = io.Discard
		if child.Start() != nil {
			stop()
			return nil, func() {}, errors.New("unable to start cloudflared")
		}
		children = append(children, child)
		go func() {
			e := child.Wait()
			select {
			case exit <- e:
			default:
			}
		}()
	}
	if len(children) == 0 {
		return nil, stop, nil
	}
	return exit, stop, nil
}

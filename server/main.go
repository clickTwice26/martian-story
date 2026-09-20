// Command server hosts the Jezero client.
//
// The game itself needs no backend - it is a pure client-side application and
// will deploy to any static host. This exists because browsers refuse ES
// modules and fetch() on a file:// origin, so *something* has to speak HTTP.
//
// It replaces `python3 -m http.server`, which has three concrete problems for
// this project:
//
//   1. No usable HTTP range support. The heightmaps are tens of megabytes and
//      the tile pyramid will grow; ranged reads are how a client fetches part
//      of a large asset without pulling all of it. The extractor already
//      depends on exactly this behaviour against USGS's S3 bucket.
//   2. No compression. jezero_base.json, the traverse GeoJSON and the JS are
//      all highly compressible; the PNGs and GLBs are not and must be left
//      alone.
//   3. No knowledge of model/gltf-binary, so .glb is served as text/plain.
//
// Stdlib only - no modules to vendor, and it builds to a single binary.
package main

import (
	"compress/gzip"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Types the browser needs and Go (or Python) does not ship by default.
var extraTypes = map[string]string{
	".glb":   "model/gltf-binary",
	".gltf":  "model/gltf+json",
	".bin":   "application/octet-stream",
	".hdr":   "image/vnd.radiance",
	".ktx2":  "image/ktx2",
	".wasm":  "application/wasm",
	".mjs":   "text/javascript; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".map":   "application/json; charset=utf-8",
}

// Already-compressed payloads: gzipping these burns CPU to make them bigger.
var incompressible = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true,
	".glb": true, ".ktx2": true, ".woff": true, ".woff2": true,
	".zip": true, ".gz": true, ".br": true, ".mp3": true, ".ogg": true, ".mp4": true,
}

type server struct {
	root    string
	verbose bool
}

type recorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *recorder) WriteHeader(c int) { r.status = c; r.ResponseWriter.WriteHeader(c) }
func (r *recorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}

type gzipWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
	n  *int64
}

func (g gzipWriter) Write(b []byte) (int, error) {
	n, err := g.gz.Write(b)
	*g.n += int64(n)
	return n, err
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	rec := &recorder{ResponseWriter: w}

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(rec, "method not allowed", http.StatusMethodNotAllowed)
		s.logReq(r, rec, start, "")
		return
	}

	// Resolve inside root; reject anything that escapes it.
	upath := r.URL.Path
	if !strings.HasPrefix(upath, "/") {
		upath = "/" + upath
	}
	clean := filepath.Clean(filepath.FromSlash(upath))
	full := filepath.Join(s.root, clean)
	rel, err := filepath.Rel(s.root, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		http.Error(rec, "forbidden", http.StatusForbidden)
		s.logReq(r, rec, start, "")
		return
	}

	info, err := os.Stat(full)
	if errors.Is(err, os.ErrNotExist) {
		http.NotFound(rec, r)
		s.logReq(r, rec, start, "")
		return
	} else if err != nil {
		http.Error(rec, "stat error", http.StatusInternalServerError)
		s.logReq(r, rec, start, "")
		return
	}

	if info.IsDir() {
		if !strings.HasSuffix(r.URL.Path, "/") {
			http.Redirect(rec, r, r.URL.Path+"/", http.StatusMovedPermanently)
			s.logReq(r, rec, start, "")
			return
		}
		full = filepath.Join(full, "index.html")
		if info, err = os.Stat(full); err != nil {
			http.NotFound(rec, r)
			s.logReq(r, rec, start, "")
			return
		}
	}

	ext := strings.ToLower(filepath.Ext(full))
	if ct, ok := extraTypes[ext]; ok {
		rec.Header().Set("Content-Type", ct)
	} else if ct := mime.TypeByExtension(ext); ct != "" {
		rec.Header().Set("Content-Type", ct)
	}

	// Baked NASA data and vendored libraries never change under a given name;
	// source is re-read constantly during development.
	switch {
	case strings.HasPrefix(rel, "data"+string(filepath.Separator)),
		strings.HasPrefix(rel, "vendor"+string(filepath.Separator)):
		rec.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	default:
		rec.Header().Set("Cache-Control", "no-cache")
	}
	rec.Header().Set("X-Content-Type-Options", "nosniff")

	f, err := os.Open(full)
	if err != nil {
		http.Error(rec, "open error", http.StatusInternalServerError)
		s.logReq(r, rec, start, "")
		return
	}
	defer f.Close()

	// Gzip only compressible types, and never alongside a Range request -
	// a ranged byte offset into a gzip stream is meaningless to the client.
	ranged := r.Header.Get("Range") != ""
	wantsGzip := strings.Contains(r.Header.Get("Accept-Encoding"), "gzip")
	if wantsGzip && !ranged && !incompressible[ext] && info.Size() > 1024 {
		rec.Header().Set("Content-Encoding", "gzip")
		rec.Header().Set("Vary", "Accept-Encoding")
		rec.Header().Del("Content-Length")
		gz, _ := gzip.NewWriterLevel(rec, gzip.BestSpeed)
		defer gz.Close()
		if r.Method == http.MethodHead {
			rec.WriteHeader(http.StatusOK)
		} else {
			_, _ = io.Copy(gzipWriter{ResponseWriter: rec, gz: gz, n: &rec.bytes}, f)
			if rec.status == 0 {
				rec.status = http.StatusOK
			}
		}
		s.logReq(r, rec, start, "gzip")
		return
	}

	// ServeContent gives us Range, If-Modified-Since and ETag for free.
	http.ServeContent(rec, r, info.Name(), info.ModTime(), f)
	note := ""
	if ranged {
		note = "range"
	}
	s.logReq(r, rec, start, note)
}

func (s *server) logReq(r *http.Request, rec *recorder, start time.Time, note string) {
	if !s.verbose {
		return
	}
	if rec.status == 0 {
		rec.status = http.StatusOK
	}
	suffix := ""
	if note != "" {
		suffix = " [" + note + "]"
	}
	log.Printf("%3d %-4s %-48s %7.1f kB %6.1f ms%s",
		rec.status, r.Method, r.URL.Path,
		float64(rec.bytes)/1024, float64(time.Since(start).Microseconds())/1000, suffix)
}

func main() {
	var (
		port    = flag.Int("port", 8123, "port to listen on")
		host    = flag.String("host", "127.0.0.1", "interface to bind")
		dir     = flag.String("dir", ".", "directory to serve")
		verbose = flag.Bool("v", true, "log requests")
	)
	flag.Parse()

	for ext, ct := range extraTypes {
		_ = mime.AddExtensionType(ext, ct)
	}

	root, err := filepath.Abs(*dir)
	if err != nil {
		log.Fatalf("resolve dir: %v", err)
	}
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		log.Fatalf("not a directory: %s", root)
	}

	addr := net.JoinHostPort(*host, fmt.Sprint(*port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen %s: %v\n(is another server still on this port?)", addr, err)
	}

	srv := &http.Server{
		Handler:           &server{root: root, verbose: *verbose},
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.SetFlags(0)
	log.Printf("jezero static server")
	log.Printf("  serving : %s", root)
	log.Printf("  url     : http://%s/", addr)
	log.Printf("  features: range requests, gzip, correct glb/gltf MIME, immutable caching for data/ and vendor/")
	log.Printf("  stop    : ctrl-c")

	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	log.Printf("stopped")
}

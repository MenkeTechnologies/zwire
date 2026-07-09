// Minimal Chromium-type shims so the ZwireAudioEq DSP class, extracted verbatim
// from fork/patches/0022-audio-eq-output.patch, compiles and runs standalone.
//
// The class only touches three Chromium/base facilities:
//   * media::AudioBus  -> channels()/frames()/channel(int)->float*
//   * base::span<float> constructed implicitly from a float* + operator[]
//   * VLOG(n) << ...   -> a sink that swallows every streamed value
//
// Nothing here re-implements DSP math; these are inert scaffolding types. The
// engine under test is #included from the generated .inc files, unmodified.
#ifndef ZWIRE_FORK_TESTS_DSP_SHIM_H_
#define ZWIRE_FORK_TESTS_DSP_SHIM_H_

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#ifndef M_SQRT2
#define M_SQRT2 1.41421356237309504880
#endif

namespace media {
// Planar float bus, one contiguous buffer per channel, matching the parts of
// media::AudioBus the engine actually calls.
class AudioBus {
 public:
  AudioBus(int channels, int frames)
      : data_(static_cast<size_t>(std::max(0, channels)),
              std::vector<float>(static_cast<size_t>(std::max(0, frames)), 0.f)) {}
  int channels() const { return static_cast<int>(data_.size()); }
  int frames() const {
    return data_.empty() ? 0 : static_cast<int>(data_[0].size());
  }
  float* channel(int c) { return data_[static_cast<size_t>(c)].data(); }

 private:
  std::vector<std::vector<float>> data_;
};
}  // namespace media

namespace base {
// Just enough of base::span<float> for `span<float> d = bus->channel(ch);` and
// `d[i]`. Implicit float*->span so the engine's assignments compile unchanged.
template <typename T>
class span {
 public:
  span(T* ptr, size_t n) : ptr_(ptr), size_(n) {}
  span(T* ptr) : ptr_(ptr), size_(0) {}  // NOLINT(runtime/explicit)
  T& operator[](size_t i) const { return ptr_[i]; }
  size_t size() const { return size_; }

 private:
  T* ptr_;
  size_t size_;
};
}  // namespace base

// VLOG(n) << a << b << ...  -> discard everything.
struct ZwireNullLogSink {
  template <class T>
  ZwireNullLogSink& operator<<(const T&) {
    return *this;
  }
};
#define VLOG(level) ZwireNullLogSink{}

#endif  // ZWIRE_FORK_TESTS_DSP_SHIM_H_

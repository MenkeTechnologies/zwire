// Drift-proof correctness test for the zwire browser-wide audio DSP engine.
//
// The engine under test (ZwireEqBand + ZwireEqConfig + ZwireAudioEq) is NOT
// copied here. run_dsp_tests.sh sed/awk-extracts it from the authoritative
// source, fork/patches/0022-audio-eq-output.patch, into two generated headers:
//
//   dsp_cfg.inc    -> ZwireEqBand, ZwireEqConfig (the config structs)
//   dsp_class.inc  -> ZwireAudioEq (preamp -> biquad EQ -> gain -> tanh drive ->
//                     compressor -> delay -> reverb -> M/S width -> pan -> limiter)
//
// So every assert below runs against the ACTUAL patch content. If the patch
// changes the DSP, this test recompiles the new code and catches regressions.
//
// The only DSP arithmetic that appears in THIS file is the 4-line M/S formula
// re-stated in test 3 to pin the exact mid/side transform against a known pair;
// that is a specification check, not a reimplementation of the engine.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <memory>

#include "dsp_shim.h"

// ---- config structs, extracted verbatim from the patch ---------------------
#include "dsp_cfg.inc"

// The extracted class calls LoadZwireEqConfig() every block and
// SeedZwireEqFromLaunchArgs() once from its ctor. In production these live in an
// anonymous namespace in the same .cc; here we supply a test-controlled slot.
static std::shared_ptr<const ZwireEqConfig> g_cfg;
static std::shared_ptr<const ZwireEqConfig> LoadZwireEqConfig() { return g_cfg; }
static bool SeedZwireEqFromLaunchArgs() { return true; }

// ---- the DSP engine, extracted verbatim from the patch ---------------------
#include "dsp_class.inc"

// ---------------------------------------------------------------------------
static int g_fails = 0;
static void check(const char* name, bool ok) {
  std::printf("  [%s] %s\n", ok ? "PASS" : "FAIL", name);
  if (!ok) ++g_fails;
}

static uint64_t g_gen = 0;
static std::shared_ptr<ZwireEqConfig> mkcfg() {
  auto c = std::make_shared<ZwireEqConfig>();
  c->generation = ++g_gen;  // force a Rebuild for every fresh config
  return c;
}

static void fill_sine(media::AudioBus& b, double hz, double sr, double amp) {
  for (int c = 0; c < b.channels(); ++c)
    for (int i = 0; i < b.frames(); ++i)
      b.channel(c)[i] = static_cast<float>(amp * std::sin(2.0 * M_PI * hz * i / sr));
}

static double rms(media::AudioBus& b, int ch, int lo, int hi) {
  double s = 0;
  for (int i = lo; i < hi; ++i) {
    float v = b.channel(ch)[i];
    s += static_cast<double>(v) * v;
  }
  return std::sqrt(s / std::max(1, hi - lo));
}

int main() {
  const int SR = 48000;
  const int CH = 2;

  // 1) UNITY = bit-identical passthrough. Default config: gain=1, width=1, no fx.
  {
    const int N = 512;
    g_cfg = mkcfg();
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N), ref(CH, N);
    fill_sine(out, 1000.0, SR, 0.5);
    fill_sine(ref, 1000.0, SR, 0.5);
    eq.Process(&out);
    bool identical = true;
    for (int c = 0; c < CH && identical; ++c)
      for (int i = 0; i < N; ++i)
        if (out.channel(c)[i] != ref.channel(c)[i]) { identical = false; break; }
    check("unity: default config is bit-identical passthrough", identical);
  }

  // 2) Brickwall limiter: limit_on, ceiling -6 dB, hot 0.9 signal never overs.
  {
    const int N = 4096;
    auto c = mkcfg();
    c->limit_on = true;
    c->limit_ceiling_db = -6.0;
    g_cfg = c;
    const double ceil_lin = std::pow(10.0, -6.0 / 20.0);
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N);
    fill_sine(out, 220.0, SR, 0.9);
    eq.Process(&out);
    bool ok = true;
    double worst = 0;
    for (int ch = 0; ch < CH; ++ch)
      for (int i = 0; i < N; ++i) {
        double a = std::fabs(static_cast<double>(out.channel(ch)[i]));
        worst = std::max(worst, a);
        if (a > ceil_lin + 1e-4) ok = false;
      }
    std::printf("       ceiling=%.6f worst_sample=%.6f\n", ceil_lin, worst);
    check("limiter: no sample exceeds the linear ceiling", ok);
  }

  // 3) M/S width. width=0 => L==R (mono). width=2 => exact mid +/- side*w math.
  {
    const int N = 64;
    const float A = 0.7f, B = -0.2f;  // known distinct L/R pair

    // width=0 -> collapse to mono
    {
      auto c = mkcfg();
      c->width = 0.0;
      g_cfg = c;
      ZwireAudioEq eq(SR, CH);
      media::AudioBus out(CH, N);
      for (int i = 0; i < N; ++i) { out.channel(0)[i] = A; out.channel(1)[i] = B; }
      eq.Process(&out);
      bool ok = true;
      const float m = 0.5f * (A + B);
      for (int i = 0; i < N; ++i)
        if (out.channel(0)[i] != out.channel(1)[i] || out.channel(0)[i] != m)
          ok = false;
      check("width=0: L and R collapse to identical mono", ok);
    }
    // width=2 -> exact M/S transform (spec check with the documented formula)
    {
      auto c = mkcfg();
      c->width = 2.0;
      g_cfg = c;
      ZwireAudioEq eq(SR, CH);
      media::AudioBus out(CH, N);
      for (int i = 0; i < N; ++i) { out.channel(0)[i] = A; out.channel(1)[i] = B; }
      eq.Process(&out);
      const float w = 2.0f;
      const float mid = 0.5f * (A + B);
      const float side = 0.5f * (A - B) * w;
      const float expL = mid + side, expR = mid - side;
      bool ok = true;
      for (int i = 0; i < N; ++i)
        if (out.channel(0)[i] != expL || out.channel(1)[i] != expR) ok = false;
      std::printf("       expL=%.6f expR=%.6f gotL=%.6f gotR=%.6f\n",
                  expL, expR, out.channel(0)[0], out.channel(1)[0]);
      check("width=2: L/R match mid+/-side*w exactly", ok);
    }
  }

  // 4) Delay: single impulse, mix=1 -> delayed copy at ~delay_ms*sr/1000 samples.
  {
    const int N = 1024;
    const double delay_ms = 5.0;
    const int expected = static_cast<int>(std::lround(delay_ms * 0.001 * SR));  // 240
    auto c = mkcfg();
    c->delay_ms = delay_ms;
    c->delay_feedback = 0.5;
    c->delay_mix = 1.0;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N);
    out.channel(0)[0] = 1.0f;  // unit impulse, left channel
    out.channel(1)[0] = 1.0f;
    eq.Process(&out);
    // mix=1 removes the dry impulse; a copy of it lands at sample `expected`.
    float at = out.channel(0)[expected];
    double pre = rms(out, 0, 1, expected);  // energy before the echo ~ 0
    std::printf("       expected_delay_sample=%d out[expected]=%.6f pre_rms=%.6g\n",
                expected, at, pre);
    check("delay: impulse reappears at delay_ms*sr/1000",
          std::fabs(at - 1.0f) < 1e-3f && pre < 1e-3);
  }

  // 5) Reverb: short burst, mix>0 -> recirculated tail energy AFTER input stops,
  //    past the shortest Freeverb comb (~1116*48000/44100 ~= 1214 samples).
  {
    const int N = 4096;
    auto c = mkcfg();
    c->reverb_mix = 0.8;
    c->reverb_room = 0.85;
    c->reverb_damp = 0.3;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N);
    for (int i = 0; i < 64; ++i) {  // burst only in the first 64 samples
      out.channel(0)[i] = 0.5f;
      out.channel(1)[i] = 0.5f;
    }
    eq.Process(&out);
    double tail = rms(out, 0, 1300, N);  // input is silent here; only the tail
    std::printf("       reverb_tail_rms[1300..%d]=%.6g\n", N, tail);
    check("reverb: recirculated tail energy appears after input stops",
          tail > 1e-4);
  }

  // 6) Compressor: ratio>1, thresh below signal -> level reduced vs. bypass.
  {
    const int N = 2048;
    // compressed
    auto con = mkcfg();
    con->comp_ratio = 8.0;
    con->comp_thresh_db = -30.0;
    g_cfg = con;
    ZwireAudioEq eqOn(SR, CH);
    media::AudioBus on(CH, N);
    fill_sine(on, 440.0, SR, 0.8);
    eqOn.Process(&on);
    // bypass (ratio=1)
    auto coff = mkcfg();
    g_cfg = coff;
    ZwireAudioEq eqOff(SR, CH);
    media::AudioBus off(CH, N);
    fill_sine(off, 440.0, SR, 0.8);
    eqOff.Process(&off);
    double on_rms = rms(on, 0, 1024, N);    // settled tail
    double off_rms = rms(off, 0, 1024, N);
    std::printf("       comp_on_rms=%.6f comp_off_rms=%.6f\n", on_rms, off_rms);
    check("compressor: output above threshold is reduced vs bypass",
          on_rms < off_rms * 0.99);
  }

  // 7) Full chain: everything engaged, several blocks, output stays finite.
  {
    const int N = 512;
    auto c = mkcfg();
    c->preamp_db = 3.0;
    c->bands.push_back(ZwireEqBand{"peaking", 1000.0, 6.0, 1.0});
    c->bands.push_back(ZwireEqBand{"lowshelf", 120.0, 4.0, 0.7});
    c->bands.push_back(ZwireEqBand{"highshelf", 8000.0, -3.0, 0.7});
    c->gain = 1.5;
    c->drive = 0.6;
    c->comp_thresh_db = -24.0;
    c->comp_ratio = 4.0;
    c->width = 1.6;
    c->pan = 0.3;
    c->limit_on = true;
    c->limit_ceiling_db = -1.0;
    c->delay_ms = 7.0;
    c->delay_feedback = 0.4;
    c->delay_mix = 0.5;
    c->reverb_mix = 0.4;
    c->reverb_room = 0.7;
    c->reverb_damp = 0.4;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    bool ok = true;
    for (int blk = 0; blk < 8 && ok; ++blk) {
      media::AudioBus out(CH, N);
      fill_sine(out, 500.0 + blk * 50.0, SR, 0.8);
      eq.Process(&out);
      for (int ch = 0; ch < CH && ok; ++ch)
        for (int i = 0; i < N; ++i)
          if (!std::isfinite(out.channel(ch)[i])) { ok = false; break; }
    }
    check("full chain: no NaN/Inf across 8 blocks with everything engaged", ok);
  }

  // 8) Lowpass filter: a 12 kHz tone is heavily attenuated vs bypass.
  {
    const int N = 4096;
    auto con = mkcfg();
    con->bands.push_back(ZwireEqBand{"lowpass", 500.0, 0.0, 0.707});
    g_cfg = con;
    ZwireAudioEq eqOn(SR, CH);
    media::AudioBus on(CH, N);
    fill_sine(on, 12000.0, SR, 0.5);
    eqOn.Process(&on);
    auto coff = mkcfg();
    g_cfg = coff;
    ZwireAudioEq eqOff(SR, CH);
    media::AudioBus off(CH, N);
    fill_sine(off, 12000.0, SR, 0.5);
    eqOff.Process(&off);
    double on_rms = rms(on, 0, 1024, N), off_rms = rms(off, 0, 1024, N);
    std::printf("       lp_on_rms=%.6f lp_off_rms=%.6f\n", on_rms, off_rms);
    check("lowpass: 12kHz tone attenuated below 25% of bypass",
          on_rms < off_rms * 0.25);
  }

  // 9) Notch filter: a tone at the notch frequency is strongly attenuated.
  {
    const int N = 8192;
    auto c = mkcfg();
    c->bands.push_back(ZwireEqBand{"notch", 1000.0, 0.0, 3.0});
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N);
    fill_sine(out, 1000.0, SR, 0.5);
    eq.Process(&out);
    double tail = rms(out, 0, 4096, N);  // settled
    std::printf("       notch_tail_rms=%.6f\n", tail);
    check("notch: on-frequency tone attenuated below 10% of input",
          tail < 0.05);
  }

  // 10) Noise gate: a signal below threshold is ducked toward silence; a loud
  //     one passes. gate_env starts open, so measure the settled release tail.
  {
    const int N = 24000;  // ~0.5s, past the 120ms release
    auto c = mkcfg();
    c->gate_thresh_db = -40.0;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus quiet(CH, N);
    fill_sine(quiet, 300.0, SR, 0.003);  // ~ -50 dB, below the gate
    eq.Process(&quiet);
    double gated = rms(quiet, 0, N - 4096, N);  // settled tail
    // loud signal (well above thresh) stays essentially unity through the gate.
    auto c2 = mkcfg();
    c2->gate_thresh_db = -40.0;
    g_cfg = c2;
    ZwireAudioEq eq2(SR, CH);
    media::AudioBus loud(CH, N);
    fill_sine(loud, 300.0, SR, 0.5);
    eq2.Process(&loud);
    double open = rms(loud, 0, N - 4096, N);
    std::printf("       gate_quiet_rms=%.8f gate_loud_rms=%.6f\n", gated, open);
    check("gate: sub-threshold signal ducked, supra-threshold passes",
          gated < 3e-4 && open > 0.3);
  }

  // 11) Bit-crusher / decimator: downsample changes the signal (not identity)
  //     and stays bounded (no runaway).
  {
    const int N = 2048;
    auto c = mkcfg();
    c->downsample = 4.0;
    c->crush_bits = 6.0;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N), ref(CH, N);
    fill_sine(out, 440.0, SR, 0.5);
    fill_sine(ref, 440.0, SR, 0.5);
    eq.Process(&out);
    bool changed = false, bounded = true;
    for (int i = 0; i < N; ++i) {
      if (out.channel(0)[i] != ref.channel(0)[i]) changed = true;
      if (std::fabs(out.channel(0)[i]) > 1.2f) bounded = false;
    }
    check("bit-crush: alters the signal and stays bounded", changed && bounded);
  }

  // 12) Haas widener: a mono input becomes decorrelated (R is a delayed copy),
  //     so L and R diverge after processing.
  {
    const int N = 4096;
    auto c = mkcfg();
    c->haas_ms = 20.0;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N);
    // 437 Hz: its period (~109.8 samples) does not divide the 20ms (960-sample)
    // Haas delay, so the delayed R genuinely diverges from L (a period-aligned
    // tone would map back onto itself and hide the effect).
    fill_sine(out, 437.0, SR, 0.5);  // identical L/R (mono)
    eq.Process(&out);
    double diff = 0;
    for (int i = 2000; i < N; ++i)
      diff += std::fabs(out.channel(0)[i] - out.channel(1)[i]);
    std::printf("       haas_LR_divergence=%.4f\n", diff);
    check("haas: mono input decorrelates into distinct L/R", diff > 1.0);
  }

  // 13) Modulation (chorus+flanger+phaser): engaged together, output is finite,
  //     non-silent, and differs from the dry input.
  {
    const int N = 4096;
    auto c = mkcfg();
    c->chorus_mix = 0.5;
    c->flanger_mix = 0.5;
    c->flanger_feedback = 0.4;
    c->phaser_mix = 0.6;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N), ref(CH, N);
    fill_sine(out, 600.0, SR, 0.5);
    fill_sine(ref, 600.0, SR, 0.5);
    eq.Process(&out);
    bool finite = true, changed = false;
    for (int i = 0; i < N; ++i) {
      if (!std::isfinite(out.channel(0)[i])) finite = false;
      if (std::fabs(out.channel(0)[i] - ref.channel(0)[i]) > 1e-4f)
        changed = true;
    }
    double e = rms(out, 0, 1024, N);
    std::printf("       mod_rms=%.6f\n", e);
    check("modulation: chorus+flanger+phaser finite, non-silent, alters signal",
          finite && changed && e > 1e-3);
  }

  // 14) Waveshaper (hard-clip, type 2): a hot input is bounded to +/-1.
  {
    const int N = 2048;
    auto c = mkcfg();
    c->shaper_amount = 1.0;
    c->shaper_type = 2.0;  // hard clip
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N), ref(CH, N);
    fill_sine(out, 300.0, SR, 0.9);
    fill_sine(ref, 300.0, SR, 0.9);
    eq.Process(&out);
    bool bounded = true, changed = false;
    for (int i = 0; i < N; ++i) {
      if (std::fabs(out.channel(0)[i]) > 1.0001f) bounded = false;
      if (out.channel(0)[i] != ref.channel(0)[i]) changed = true;
    }
    check("waveshaper: hard-clip bounds to +/-1 and alters signal",
          bounded && changed);
  }

  // 15) Ring modulator: alters the signal, stays finite and non-silent.
  {
    const int N = 4096;
    auto c = mkcfg();
    c->ringmod_mix = 1.0;
    c->ringmod_freq = 500.0;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N), ref(CH, N);
    fill_sine(out, 440.0, SR, 0.5);
    fill_sine(ref, 440.0, SR, 0.5);
    eq.Process(&out);
    bool finite = true, changed = false;
    for (int i = 0; i < N; ++i) {
      if (!std::isfinite(out.channel(0)[i])) finite = false;
      if (std::fabs(out.channel(0)[i] - ref.channel(0)[i]) > 1e-4f) changed = true;
    }
    check("ring-mod: alters signal, finite, non-silent",
          finite && changed && rms(out, 0, 0, N) > 1e-3);
  }

  // 16) Tremolo: amplitude-only modulation — output never exceeds the dry peak
  //     yet dips well below it at an LFO trough.
  {
    const int N = 8192;
    auto c = mkcfg();
    c->tremolo_depth = 1.0;
    c->tremolo_rate_hz = 40.0;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N);
    fill_sine(out, 1000.0, SR, 0.5);
    eq.Process(&out);
    float peak = 0;
    double trough_rms = 1e9;
    for (int w = 0; w + 256 <= N; w += 256) {
      double s = 0;
      for (int i = w; i < w + 256; ++i) {
        peak = std::max(peak, std::fabs(out.channel(0)[i]));
        s += out.channel(0)[i] * out.channel(0)[i];
      }
      trough_rms = std::min(trough_rms, std::sqrt(s / 256));
    }
    std::printf("       trem_peak=%.4f trough_rms=%.6f\n", peak, trough_rms);
    check("tremolo: bounded by dry peak, dips to a near-silent trough",
          peak <= 0.5001f && trough_rms < 0.05);
  }

  // 17) Auto-pan: a mono input diverges into distinct L/R as the pan sweeps.
  {
    const int N = 8192;
    auto c = mkcfg();
    c->autopan_depth = 1.0;
    c->autopan_rate_hz = 4.0;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N);
    fill_sine(out, 437.0, SR, 0.5);  // identical L/R
    eq.Process(&out);
    double diff = 0;
    for (int i = 0; i < N; ++i)
      diff += std::fabs(out.channel(0)[i] - out.channel(1)[i]);
    std::printf("       autopan_LR_divergence=%.2f\n", diff);
    check("auto-pan: mono input sweeps into distinct L/R", diff > 1.0);
  }

  // 18) Auto-wah: envelope-swept band-pass alters the signal and stays finite.
  {
    const int N = 8192;
    auto c = mkcfg();
    c->autowah_mix = 1.0;
    c->autowah_sens = 0.8;
    c->autowah_base = 400.0;
    g_cfg = c;
    ZwireAudioEq eq(SR, CH);
    media::AudioBus out(CH, N), ref(CH, N);
    fill_sine(out, 1200.0, SR, 0.5);
    fill_sine(ref, 1200.0, SR, 0.5);
    eq.Process(&out);
    bool finite = true, changed = false;
    for (int i = 0; i < N; ++i) {
      if (!std::isfinite(out.channel(0)[i])) finite = false;
      if (std::fabs(out.channel(0)[i] - ref.channel(0)[i]) > 1e-4f) changed = true;
    }
    check("auto-wah: envelope band-pass alters signal, finite",
          finite && changed);
  }

  std::printf("\n%s (%d failure%s)\n", g_fails == 0 ? "ALL PASS" : "FAILURES",
              g_fails, g_fails == 1 ? "" : "s");
  return g_fails == 0 ? 0 : 1;
}

<template>
  <div class="hsv-picker" :class="{ open }" ref="rootRef">
    <button
      type="button"
      class="hsv-swatch"
      :style="{ backgroundColor: modelValue || 'transparent' }"
      :title="modelValue"
      @click="open = !open"
    >
      <span class="hsv-swatch-checker"></span>
    </button>
    <div v-if="open" class="hsv-pop" @pointerdown.stop>
      <div
        class="hsv-plane"
        ref="planeRef"
        :style="{ background: planeBackground }"
        @pointerdown="startPlaneDrag"
      >
        <div class="hsv-plane-cursor" :style="planeCursorStyle"></div>
      </div>
      <div class="hsv-slider hue">
        <input type="range" min="0" max="360" step="1" :value="h" @input="setH(+$event.target.value)" />
      </div>
      <div v-if="alpha" class="hsv-slider alpha" :style="{ '--alpha-bg': alphaSliderBg }">
        <input type="range" min="0" max="100" step="1" :value="aPct" @input="setA(+$event.target.value / 100)" />
      </div>
      <div class="hsv-fields">
        <label><span>H</span><input type="number" min="0" max="360" :value="h" @input="setH(+$event.target.value)" /></label>
        <label><span>S</span><input type="number" min="0" max="100" :value="s" @input="setS(+$event.target.value)" /></label>
        <label><span>V</span><input type="number" min="0" max="100" :value="v" @input="setV(+$event.target.value)" /></label>
        <label v-if="alpha"><span>A</span><input type="number" min="0" max="100" :value="aPct" @input="setA(+$event.target.value / 100)" /></label>
      </div>
      <label class="hsv-text-field">
        <span>{{ alpha ? "HEX / RGBA" : "HEX" }}</span>
        <input type="text" :value="textValue" @change="setText($event.target.value)" />
      </label>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"

const props = defineProps({
  modelValue: { type: String, default: "" },
  alpha: { type: Boolean, default: false },
})
const emit = defineEmits(["update:modelValue"])

const rootRef = ref(null)
const planeRef = ref(null)
const open = ref(false)
const h = ref(0)
const s = ref(0)
const v = ref(0)
const a = ref(1)
let updatingFromProp = false

const aPct = computed(() => Math.round(a.value * 100))

const planeBackground = computed(() => {
  const hueColor = `hsl(${h.value}, 100%, 50%)`
  return `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`
})

const planeCursorStyle = computed(() => ({
  left: `${s.value}%`,
  top: `${100 - v.value}%`,
}))

const alphaSliderBg = computed(() => {
  const { r, g, b } = hsvToRgb(h.value, s.value, v.value)
  return `linear-gradient(to right, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1))`
})

const textValue = computed(() => formatColor())

watch(() => props.modelValue, (val) => {
  parseColor(val || "")
}, { immediate: true })

onMounted(() => {
  document.addEventListener("pointerdown", onDocClick)
  document.addEventListener("keydown", onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocClick)
  document.removeEventListener("keydown", onKey)
})

function onDocClick(e) {
  if (!open.value) return
  if (rootRef.value && !rootRef.value.contains(e.target)) {
    open.value = false
  }
}
function onKey(e) {
  if (e.key === "Escape") open.value = false
}

function startPlaneDrag(e) {
  movePlane(e)
  const move = (ev) => movePlane(ev)
  const up = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
}
function movePlane(e) {
  const rect = planeRef.value && planeRef.value.getBoundingClientRect()
  if (!rect) return
  const x = clamp(e.clientX - rect.left, 0, rect.width)
  const y = clamp(e.clientY - rect.top, 0, rect.height)
  s.value = Math.round((x / rect.width) * 100)
  v.value = Math.round((1 - y / rect.height) * 100)
  pushOut()
}

function setH(val) { h.value = clamp(val, 0, 360); pushOut() }
function setS(val) { s.value = clamp(val, 0, 100); pushOut() }
function setV(val) { v.value = clamp(val, 0, 100); pushOut() }
function setA(val) { a.value = clamp(val, 0, 1); pushOut() }
function setText(val) {
  parseColor(String(val || ""), true)
  pushOut()
}

function pushOut() {
  if (updatingFromProp) return
  emit("update:modelValue", formatColor())
}

function formatColor() {
  const { r, g, b } = hsvToRgb(h.value, s.value, v.value)
  if (props.alpha && a.value < 1) {
    return `rgba(${r}, ${g}, ${b}, ${roundA(a.value)})`
  }
  return rgbToHex(r, g, b)
}

function parseColor(input, force = false) {
  const text = String(input || "").trim()
  if (!text) {
    if (force) {
      h.value = 0; s.value = 0; v.value = 0; a.value = 1
    }
    return
  }
  updatingFromProp = !force
  let r = 0, g = 0, bl = 0, al = 1
  const hex = text.match(/^#([0-9a-f]{3,8})$/i)
  const rgb = text.match(/^rgba?\(([^)]+)\)$/i)
  if (hex) {
    const hx = hex[1]
    if (hx.length === 3) {
      r = parseInt(hx[0] + hx[0], 16); g = parseInt(hx[1] + hx[1], 16); bl = parseInt(hx[2] + hx[2], 16)
    } else if (hx.length === 6 || hx.length === 8) {
      r = parseInt(hx.slice(0, 2), 16); g = parseInt(hx.slice(2, 4), 16); bl = parseInt(hx.slice(4, 6), 16)
      if (hx.length === 8) al = parseInt(hx.slice(6, 8), 16) / 255
    }
  } else if (rgb) {
    const parts = rgb[1].split(",").map((x) => x.trim())
    r = clamp(parseFloat(parts[0]) || 0, 0, 255)
    g = clamp(parseFloat(parts[1]) || 0, 0, 255)
    bl = clamp(parseFloat(parts[2]) || 0, 0, 255)
    al = parts[3] !== undefined ? clamp(parseFloat(parts[3]) || 0, 0, 1) : 1
  } else {
    updatingFromProp = false
    return
  }
  const hsv = rgbToHsv(r, g, bl)
  h.value = Math.round(hsv.h)
  s.value = Math.round(hsv.s)
  v.value = Math.round(hsv.v)
  a.value = al
  updatingFromProp = false
}

function clamp(val, min, max) {
  const n = Number(val)
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, n))
}
function roundA(val) {
  return Math.round(val * 100) / 100
}
function hsvToRgb(hue, sat, val) {
  const S = sat / 100
  const V = val / 100
  const C = V * S
  const Hp = (hue % 360) / 60
  const X = C * (1 - Math.abs((Hp % 2) - 1))
  let r1 = 0, g1 = 0, b1 = 0
  if (Hp >= 0 && Hp < 1) { r1 = C; g1 = X }
  else if (Hp < 2) { r1 = X; g1 = C }
  else if (Hp < 3) { g1 = C; b1 = X }
  else if (Hp < 4) { g1 = X; b1 = C }
  else if (Hp < 5) { r1 = X; b1 = C }
  else { r1 = C; b1 = X }
  const m = V - C
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}
function rgbToHsv(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const d = max - min
  let hue = 0
  if (d !== 0) {
    if (max === R) hue = 60 * (((G - B) / d) % 6)
    else if (max === G) hue = 60 * (((B - R) / d) + 2)
    else hue = 60 * (((R - G) / d) + 4)
    if (hue < 0) hue += 360
  }
  const sat = max === 0 ? 0 : d / max
  return { h: hue, s: sat * 100, v: max * 100 }
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => clamp(x, 0, 255).toString(16).padStart(2, "0")).join("")
}
</script>

<style scoped>
.hsv-picker {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 100%;
}
.hsv-swatch {
  position: relative;
  width: 100%;
  height: 32px;
  padding: 0;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.18));
  border-radius: 6px;
  cursor: pointer;
  background-clip: padding-box;
  overflow: hidden;
}
.hsv-swatch-checker {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(45deg, #888 25%, transparent 25%),
    linear-gradient(-45deg, #888 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #888 75%),
    linear-gradient(-45deg, transparent 75%, #888 75%);
  background-color: #444;
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
}
.hsv-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  display: grid;
  gap: 8px;
  width: 220px;
  padding: 10px;
  background: var(--picker-bg, #fffafa);
  border: 1px solid var(--line, rgba(36, 27, 32, 0.16));
  border-radius: 10px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
}
.hsv-plane {
  position: relative;
  width: 100%;
  height: 140px;
  border-radius: 6px;
  cursor: crosshair;
  touch-action: none;
}
.hsv-plane-cursor {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.hsv-slider {
  position: relative;
  height: 14px;
  border-radius: 7px;
}
.hsv-slider.hue {
  background: linear-gradient(
    to right,
    #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%,
    #00f 67%, #f0f 83%, #f00 100%
  );
}
.hsv-slider.alpha {
  background:
    var(--alpha-bg),
    repeating-conic-gradient(#888 0 25%, #444 0 50%) 0 0 / 8px 8px;
}
.hsv-slider input[type="range"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
}
.hsv-slider input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(0, 0, 0, 0.7);
  cursor: pointer;
}
.hsv-slider input[type="range"]::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(0, 0, 0, 0.7);
  cursor: pointer;
}
.hsv-fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}
.hsv-fields label {
  display: grid;
  grid-template-rows: auto auto;
  gap: 2px;
  text-align: center;
  font-size: 11px;
  color: var(--muted, #6f6469);
}
.hsv-fields input {
  width: 100%;
  padding: 2px 4px;
  font-size: 12px;
}
.hsv-text-field {
  display: grid;
  gap: 3px;
  font-size: 11px;
  color: var(--muted, #6f6469);
}
.hsv-text-field input {
  width: 100%;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--text, #241b20);
  background: var(--field-bg, #ffffff);
  border: 1px solid var(--line, rgba(36, 27, 32, 0.16));
}
</style>

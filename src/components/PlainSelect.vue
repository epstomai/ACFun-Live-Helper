<template>
  <div ref="rootRef" class="ss-root" :class="{ open }">
    <button
      type="button"
      class="ss-trigger"
      :title="selectedLabel"
      @click="toggle"
    >
      <span class="ss-value" :class="{ placeholder: !selectedLabel }">
        {{ selectedLabel || placeholder }}
      </span>
      <ChevronDown :size="14" class="ss-arrow" />
    </button>
    <div v-if="open" class="ss-panel plain-select-panel" @pointerdown.stop>
      <ul class="ss-options">
        <li
          v-for="opt in normalizedOptions"
          :key="opt.value"
          class="ss-option"
          :class="{ selected: opt.value === modelValue }"
          @mousedown.prevent="select(opt.value)"
        >{{ opt.label }}</li>
        <li v-if="!normalizedOptions.length" class="ss-empty">无可用选项</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { ChevronDown } from "@lucide/vue"

const props = defineProps({
  modelValue: { type: [String, Number], default: "" },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "请选择" },
})

const emit = defineEmits(["update:modelValue", "change"])

const open = ref(false)
const rootRef = ref(null)

const normalizedOptions = computed(() => props.options.map((item) => {
  if (item && typeof item === "object") {
    return {
      label: String(item.label ?? item.displayName ?? item.name ?? item.value ?? ""),
      value: item.value ?? item.name ?? item.label ?? "",
    }
  }
  return { label: String(item), value: item }
}))

const selectedLabel = computed(() => {
  const selected = normalizedOptions.value.find((item) => item.value === props.modelValue)
  return selected ? selected.label : ""
})

function toggle() {
  open.value = !open.value
}

function select(value) {
  if (value !== props.modelValue) {
    emit("update:modelValue", value)
  }
  emit("change", value)
  open.value = false
}

function onDocMousedown(event) {
  if (!open.value) return
  if (rootRef.value && !rootRef.value.contains(event.target)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener("mousedown", onDocMousedown))
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocMousedown))
</script>

<style scoped>
.ss-root {
  position: relative;
  display: block;
  width: 100%;
}

.ss-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--field-bg, var(--page));
  color: var(--text);
  font: inherit;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
}

.ss-trigger:hover {
  border-color: rgba(253, 76, 93, 0.45);
}

.ss-root.open .ss-trigger {
  border-color: #fd4c5d;
}

.ss-value {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}

.ss-value.placeholder {
  color: var(--muted);
}

.ss-arrow {
  flex: 0 0 auto;
  color: var(--muted);
  transition: transform 160ms ease;
}

.ss-root.open .ss-arrow {
  transform: rotate(180deg);
  color: #fd4c5d;
}

.ss-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--picker-bg, var(--page));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  min-width: 200px;
  max-height: 300px;
}

.plain-select-panel {
  padding: 6px;
}

.ss-options {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  max-height: 240px;
}

.ss-option {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  color: var(--text);
}

.ss-option:hover {
  background: rgba(253, 76, 93, 0.08);
}

.ss-option.selected {
  color: #fd4c5d;
  font-weight: 600;
  background: rgba(253, 76, 93, 0.12);
}

.ss-empty {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
</style>

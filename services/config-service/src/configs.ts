import assert from "node:assert";

export type LoraConfig = {
  lora_url: string;
  lora_weight: number;
  updated_at: string;
};

export const loraConfigs: LoraConfig[] = [
  {
    lora_url:
      "https://huggingface.co/vislupus/SD1.5-LoRA-Your-Name-Style/resolve/main/yn_style_v1-000039.safetensors",
    lora_weight: 0.8,
    updated_at: "2026-02-03T10:00:00Z",
  },
  {
    lora_url:
      "https://huggingface.co/vislupus/SD1.5-LoRA-Loving-Vincent-Style/resolve/main/vg_style_v1-000048.safetensors",
    lora_weight: 0.9,
    updated_at: "2026-02-03T10:00:00Z",
  },
  {
    lora_url:
      "https://huggingface.co/vislupus/SD1.5-LoRA-Wolfwalkers-Style/resolve/main/ww_style_final_v1-000046.safetensors",
    lora_weight: 0.7,
    updated_at: "2026-02-03T10:00:00Z",
  },
  {
    lora_url:
      "https://huggingface.co/ampp/N64_style_sd1.5/resolve/main/N64%20Lowpoly.safetensors",
    lora_weight: 0.8,
    updated_at: "2026-02-03T10:00:00Z",
  },
];

for (const config of loraConfigs) {
  const url = new URL(config.lora_url);

  assert(url.hostname === "huggingface.co");
  assert(config.lora_weight >= 0);
  assert(config.lora_weight <= 1);
}

"""Isolated per-role LoRA for CosyVoice3; official base weights remain frozen."""
import torch
from torch import nn
TARGETS = ('q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj')


class RoleLinear(nn.Module):
    def __init__(self, base, rank=16):
        super().__init__()
        self.base = base
        self.scale = 1.0
        self.a = nn.Linear(base.in_features, rank, bias=False, device=base.weight.device, dtype=torch.float32)
        self.b = nn.Linear(rank, base.out_features, bias=False, device=base.weight.device, dtype=torch.float32)
        nn.init.normal_(self.a.weight, std=.02)
        nn.init.zeros_(self.b.weight)
        self.base.requires_grad_(False)

    def forward(self, value):
        original = self.base(value)
        delta = self.b(self.a(value.float()))
        return original + self.scale * delta.to(original.dtype)


def attach(llm, rank=16):
    llm.requires_grad_(False)
    names = [name for name, layer in llm.llm.model.model.named_modules() if isinstance(layer, nn.Linear) and name.split('.')[-1] in TARGETS]
    for name in names:
        parent, leaf = name.rsplit('.', 1)
        owner = llm.llm.model.model.get_submodule(parent)
        setattr(owner, leaf, RoleLinear(getattr(owner, leaf), rank))
    return names


def adapter_state(llm):
    return {name: value.detach().cpu().clone() for name, value in llm.named_parameters() if name.endswith(('.a.weight', '.b.weight'))}


def load(llm, file):
    attach(llm)
    weights = torch.load(file, map_location='cpu', weights_only=True)
    expected = set(adapter_state(llm))
    if set(weights) != expected:
        raise RuntimeError('Unexpected CosyVoice adapter tensor set')
    llm.load_state_dict(weights, strict=False)
    llm.requires_grad_(False)

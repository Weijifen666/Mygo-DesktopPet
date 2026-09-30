"""The inference-only flow adapter used by the accepted local CosyVoice model."""

from torch import nn

from cosy_adapters import RoleLinear


def attach_flow(flow):
    flow.requires_grad_(False)
    names = [name for name, layer in flow.named_modules() if isinstance(layer, nn.Linear)
        and not any(part in ('base', 'a', 'b') for part in name.split('.')) and (
        '.attn.to_' in name or '.ff.ff.' in name or name in ('decoder.estimator.input_embed.proj', 'decoder.estimator.proj_out'))]
    for name in names:
        parent, leaf = name.rsplit('.', 1)
        owner = flow.get_submodule(parent)
        setattr(owner, leaf, RoleLinear(getattr(owner, leaf), rank=8))
    flow.spk_embed_affine_layer.float().requires_grad_(True)
    return names


def flow_state(flow):
    return {name: p.detach().cpu().clone() for name, p in flow.named_parameters()
            if name.endswith(('.a.weight', '.b.weight')) or name.startswith('spk_embed_affine_layer.')}

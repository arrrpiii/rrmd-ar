"""Runtime-independent crop planning; coordinates remain in original-image space."""
import math

def crop_box(size, regions, enabled=True, mode="tight"):
    w, h = size
    if not enabled:
        return (0, 0, w, h)
    x0 = min(r[0] for r in regions) * w
    y0 = min(r[1] for r in regions) * h
    x1 = max(r[0] + r[2] for r in regions) * w
    y1 = max(r[1] + r[3] for r in regions) * h
    # Regions already include placement padding. Keep a smaller extra context
    # margin, including at least four feather radii, without splitting a pair.
    if mode not in ('tight', 'balanced'):
        raise ValueError('TRYON_CROP_MODE must be tight or balanced')
    if mode == 'balanced':
        cw = min(w, max((x1-x0)*2, w*.45))
        ch = min(h, max((y1-y0)*2.4, h*.4))
    else:
        margin = max(8, w*.028)
        cw = min(w, max((x1-x0)*1.4, x1-x0+2*margin, w*.28))
        ch = min(h, max((y1-y0)*1.65, y1-y0+2*margin, h*.24))
    left = max(0, min(w-cw, (x0+x1-cw)/2))
    top = max(0, min(h-ch, (y0+y1-ch)/2))
    return (math.floor(left), math.floor(top), math.ceil(left+cw), math.ceil(top+ch))

def working_size(size, limit):
    scale = min(1, limit/max(size))
    return tuple(max(64, int(d*scale)//16*16) for d in size)

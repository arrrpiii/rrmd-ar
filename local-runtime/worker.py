"""Offline MLX editor. --serve retains weights across sequential jobs."""
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ['HF_HOME'] = str(ROOT / '.local-models/hf-cache')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['MPLCONFIGDIR'] = str(ROOT / '.local-models/matplotlib')

from imaging import crop_box, working_size
import contextlib
import gc

model = None
job = None
started = 0

def progress(stage, **extra):
    temp = job / 'progress.tmp'
    temp.write_text(json.dumps({'stage': stage, 'elapsed': round(time.time()-started, 2), **extra}))
    temp.replace(job / 'progress.json')

def generate(folder):
    global model, job, started
    job = Path(folder).resolve()
    started = time.time()
    warm = model is not None
    progress('Preparing edit' if warm else 'Loading model')
    from PIL import Image, ImageFilter, ImageDraw
    import mlx.core as mx
    from mflux.models.common.config import ModelConfig
    from mflux.models.flux2.variants import Flux2KleinEdit
    from mflux.callbacks.instances.memory_saver import MemorySaver
    from mflux.callbacks.callback import InLoopCallback
    mx.reset_peak_memory()
    settings = json.loads((job / 'settings.json').read_text())
    # Bound working resolution and reference tokens to fit 16 GB unified memory.
    original = Image.open(job / 'photo.png').convert('RGB')
    guide = Image.open(job / 'guide.png').convert('RGB')
    box = crop_box(guide.size, settings['regions'], os.getenv('TRYON_CROP', '1') == '1', os.getenv('TRYON_CROP_MODE', 'tight'))
    crop = guide.crop(box)
    limit = int(os.getenv('TRYON_MAX_SIDE', '768'))
    if not 256 <= limit <= 1024:
        raise ValueError('TRYON_MAX_SIDE must be between 256 and 1024')
    w, h = working_size(crop.size, limit)
    crop.resize((w,h), Image.Resampling.LANCZOS).save(job / 'edit-input.png')
    product = Image.open(job / 'product.png').convert('RGB')
    product.thumbnail((384,384), Image.Resampling.LANCZOS)
    product.save(job / 'reference.png')
    if model is None:
        model = Flux2KleinEdit(model_config=ModelConfig.flux2_klein_4b(), model_path=os.getenv('TRYON_MODEL_PATH', str(ROOT / '.local-models/flux2-klein-4b-4bit')))
        # Flux2 re-encodes each prompt: retain the encoder as well as transformer.
        saver = MemorySaver(model=model, keep_transformer=True, num_seeds=2, cache_limit_bytes=256*1024*1024)
        model.callbacks.register(saver)
        class Steps(InLoopCallback):
            def call_in_loop(self, t, **kwargs):
                progress('Refining jewellery', step=int(t)+1, total=4)
        model.callbacks.register(Steps())
    preparation = time.time() - started
    category = {'earrings':'the pair of earrings attached to the earlobes', 'pendant':'the pendant resting on the upper chest at its indicated attachment', 'necklace':'the necklace around the neck and over the upper chest', 'ring':'the ring encircling the ring finger at the indicated location', 'bracelet':'the bracelet encircling the wrist at the indicated location'}[settings['kind']]
    prompt = (
        f'Edit image 1 into a realistic photograph of this same person actually wearing {category}. '
        'Image 1 contains a rough pasted jewellery placement. Image 2 is the product reference. '
        'Keep the same jewellery design, stone arrangement, metal color and approximate size. '
        'Replace the pasted look with natural attachment, individual perspective and angle, realistic metal reflections, '
        'soft contact shadows and existing hair passing in front where appropriate. '
        'Keep rigid metal shapes intact. Only flexible necklace chains may drape naturally. '
        'Preserve the exact person, face, expression, skin, hairstyle, clothing, background and framing. '
        'Do not add new jewellery, chains, ornaments, text or logos. Output only the edited photograph from image 1.'
    )
    progress('Encoding photo and jewellery')
    image = model.generate_image(seed=settings.get('seed',42),prompt=prompt,image_paths=[job/'edit-input.png',job/'reference.png'],num_inference_steps=4,width=w,height=h,guidance=1.0)
    image.image.save(job / 'raw-generated.png')
    progress('Preserving the original portrait')
    generated = original.copy()
    generated.paste(image.image.convert('RGB').resize(crop.size, Image.Resampling.LANCZOS), box[:2])
    mask = Image.new('L',original.size,0)
    draw = ImageDraw.Draw(mask)
    for region in settings['regions']:
        x,y,rw,rh = region
        # Region includes a little surrounding skin/hair so contact can be reconstructed.
        draw.rounded_rectangle((int(x*original.width),int(y*original.height),int((x+rw)*original.width),int((y+rh)*original.height)),radius=max(2,int(min(rw*original.width,rh*original.height)*.15)),fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(max(2,original.width*.007)))
    # Blend *model-generated* local regions into the original; keep identity/background outside intact.
    Image.composite(generated,original,mask).save(job/'result.png')
    mask.save(job/'edit-mask.png')
    output_width, output_height = original.size
    peak = round(mx.get_peak_memory()/1e9, 2)
    del image, generated, original, guide, crop, product, mask, draw
    gc.collect()
    mx.clear_cache()
    progress('Complete', width=output_width, height=output_height, working_width=w, working_height=h,
             crop=list(box), warm_model=warm, preparation_seconds=round(preparation, 2), peak_memory_gb=peak)

def run(folder):
    global model
    try:
        with (Path(folder)/'worker.log').open('a') as log, contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            generate(folder)
        return True
    except Exception as exc:
        progress('Failed', error=f'{type(exc).__name__}: {exc}')
        # Exit after failure rather than reuse potentially damaged model state.
        return False

if __name__ == '__main__':
    if sys.argv[1:] == ['--serve']:
        for line in sys.stdin:
            if not run(json.loads(line)['folder']):
                sys.exit(1)
    else:
        sys.exit(0 if run(sys.argv[1]) else 1)

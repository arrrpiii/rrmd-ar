from pathlib import Path
import os
root=Path(__file__).resolve().parent.parent
os.environ['HF_HOME']=str(root/'.local-models/hf-cache')
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
from huggingface_hub import snapshot_download
path=root/'.local-models/flux2-klein-4b-4bit'
snapshot_download('mlx-community/flux2-klein-4b-4bit',revision='860e87183ceb29e39627c0612ebd66d8ea66e68c',local_dir=path,max_workers=3)
(path/'.download-complete').write_text('860e87183ceb29e39627c0612ebd66d8ea66e68c\n')
print('Local model is ready.')

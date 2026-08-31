---
title: 'Masterclass: Machine Learning in Houdini'
description: 'Notes from Josh Karlin’s EPC 2026 masterclass: running ONNX models across COPs, SOPs and VDBs, exporting from PyTorch, PCA, and training inside Houdini.'
date: 2026-04-09
tags: [Houdini, ML, ONNX, COP, SOP, Volumes, VDB, Python, NumPy]
---

**Josh Karlin · EPC 2026 Masterclass · April 9, 2026**

How to load and run pre-trained machine-learning models inside Houdini using the **ONNX** format across COPs (images), SOPs (geometry), and VDBs (volumes).

## ONNX format overview

ONNX is a file format built to represent the building blocks of machine-learning models. It contains five key components:

1. **Computation graph** — a graph of mathematical operators with tensors flowing between them.
2. **Learned parameters** — trained weights, biases, and embeddings stored as serialized binary data.
3. **Inputs and outputs** — the tensors that define the model interface.
4. **Operator sets (opsets)** — versioned operator definitions that ensure compatibility.
5. **Optional metadata** — information such as the model author and training framework.

Graph optimizations include **constant folding**, where static subgraphs are precomputed, and **quantization**, which reduces numerical precision for better performance.

### ONNX vs USD

| | ONNX | USD |
|---|---|---|
| Purpose | Represents ML computation | Describes static or dynamic scene structure |
| Data | Mathematical operations on tensors | Geometry, lights, cameras, and materials |

[Netron](https://netron.app/) is a useful tool for visualizing ONNX model graphs.

## ONNX in COPs: image processing

COPs are the natural context for models that operate on images. The ONNX Inference node exposes tensor shapes as batch size, channel count, height, and width.

![ONNX tensor shape controls in Houdini.](/images/houdini_ml_masterclass/tensor-shape.webp)

Always run **Setup Shapes from Model** on the ONNX Inference node before cooking.

![Setup Shapes from Model on an ONNX Inference node.](/images/houdini_ml_masterclass/setup-shapes.webp)

![An ONNX inference network operating in COPs.](/images/houdini_ml_masterclass/cop-inference.webp)

Houdini imports images using its configured **OCIO** color workflow, so color-space transforms must be accounted for around inference.

![OCIO color processing around an inference graph.](/images/houdini_ml_masterclass/ocio-colour.webp)

Restore the original resolution and intended color space after inference. Set the output tensor order to `YX`, and enable **Collate Channels Separately** when required by the model.

![Restoring image resolution and color after inference.](/images/houdini_ml_masterclass/restore-image.webp)

The ONNX Inference node can also split a single tensor result into multiple outputs.

![Splitting a tensor into multiple COP outputs.](/images/houdini_ml_masterclass/multiple-outputs.webp)

## ONNX in SOPs: geometry and volumes

Input layout matters. Some models expect planar channels such as `RRRGGGBBB`, not interleaved data such as `RGBRGBRGB`. In that case, merge the channels into one large column before inference.

![Preparing planar channel data for ONNX inference in SOPs.](/images/houdini_ml_masterclass/sop-channel-layout.webp)

ONNX Inference can also accept a volume as input.

![A Houdini volume connected to an ONNX inference workflow.](/images/houdini_ml_masterclass/volume-inference.webp)

A useful node-network pattern for volume inference is:

```text
copnet → onnx → volumevectorjoin → volumewrangle
```

The masterclass files also demonstrate the reverse bridge: using a SOP inside COPs through `copnet4` and `sopinvoke6`.

## Resizing models for dynamic input

A `-1` in an input graph shape indicates a dynamic or flexible dimension. When exporting from PyTorch, use `dynamic_axes` to identify dimensions such as height and width that may change at runtime.

## Exporting an ONNX model from PyTorch

The basic workflow is:

1. Drag a COP node to TOPs to trigger the export pipeline.
2. Locate the model implementation and its `.pth` weights in the source repository.
3. Create a Python environment with the required packages.

![Python environment setup for exporting a model to ONNX.](/images/houdini_ml_masterclass/python-environment.webp)

### Static-resolution export

```python
import torch
import sys
import re

sys.path.append("$HIP/neural_style")
from transformer_net import TransformerNet

with torch.no_grad():
    model = TransformerNet()
    model_dict = torch.load("$HIP/neural_style/saved_models/mosaic.pth")

    for key in list(model_dict.keys()):
        if re.search("some regular expression", key):
            del model_dict[key]

    model.load_state_dict(model_dict)

    torch.onnx.export(
        model,
        torch.randn(1, 3, 1024, 1024),
        "$HIP/onnx_models/mosaic_9_1024.onnx",
        input_names=["input"],
        output_names=["output"],
        opset_version=19,
        dynamo=False,
        external_data=False,
    )
```

Models larger than 2 GB may export into `.onnx` and `.onnx_data` files when external data is enabled; that form was not supported by the demonstrated Houdini workflow.

### Dynamic-resolution export

```python
import torch
import sys
import re

sys.path.append("$HIP/neural_style")
from transformer_net import TransformerNet

with torch.no_grad():
    model = TransformerNet()
    model_dict = torch.load("$HIP/neural_style/saved_models/mosaic.pth")

    for key in list(model_dict.keys()):
        if re.search(r"in\d+\.running_(mean|var)$", key):
            del model_dict[key]

    model.load_state_dict(model_dict)

    torch.onnx.export(
        model,
        torch.randn(1, 3, 1024, 1024),
        "$HIP/onnx_models/mosaic_9_1024.onnx",
        input_names=["input"],
        output_names=["output"],
        opset_version=19,
        dynamo=False,
        external_data=False,
        dynamic_axes={
            "input": {2: "height", 3: "width"},
            "output": {2: "height", 3: "width"},
        },
    )
```

The [ONNX Simplifier](https://github.com/daquexian/onnx-simplifier) can clean and optimize the exported graph.

## Principal component analysis

Principal component analysis (PCA) identifies the most important components in data. One practical Houdini use is removing jitter noise from a simulation. SideFX has an advanced [PCA de-jitter tutorial](https://www.sidefx.com/tutorials/pca-dejitter/) demonstrating the technique.

## Creating a dataset and training in Houdini

The `ML_EXAMPLE` node receives the model input data through its first input and the expected result, or ground truth, through its second. PCA can then reduce the dataset to its most important features.

![Preparing training examples with the ML Example node.](/images/houdini_ml_masterclass/ml-example.webp)

`ML_REGRESSION` trains an ONNX model automatically from those PCA-extracted features rather than from the complete raw input. The ML examples on the SideFX website provide more complete training workflows.

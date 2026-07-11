---
title: 'Houdini Volumes and NumPy'
description: 'Python scripting with volumes in Houdini can outperform VEX for array-heavy workloads — here is how to move voxel data between Houdini and NumPy.'
date: 2023-07-15
tags: [Houdini, Volumes, Python, NumPy]
---

Python scripting with volumes in Houdini may be considered an uncommon practice, but it can offer tremendous benefits in various scenarios. In fact, it can even outperform VEX scripting in terms of speed and efficiency.

## What is a NumPy array?

NumPy (Numerical Python) is a fundamental library in Python used for numerical and scientific computing. One of the core features of NumPy is the "NumPy array", also known as `ndarray` (short for n-dimensional array). It is a powerful data structure that allows you to work with arrays and matrices of various dimensions efficiently and perform operations on them in an optimized manner.

It is implemented in C and Fortran, which makes it highly efficient for numerical computations. It leverages optimized, low-level memory operations, which result in faster execution compared to regular Python lists.

Despite being a Python library, its performance is comparable with VEX. NumPy arrays are supported by lots of Python libraries: they can be processed with SciPy, converted to pictures, fed as tensors into neural networks, and much more.

## Convert a Houdini volume to a NumPy array

A Houdini volume looks like a 3-dimensional array, which is common for NumPy. But in fact the data is stored as a sequence of voxel ids and float values that correspond to each id.

![Voxel data attributes](/images/houdini_numpy/voxels_data_attrib.jpg)

The Houdini Python documentation already has a fast, performant function that gets all voxel data into a tuple for converting into a NumPy array: [hou.Volume](https://www.sidefx.com/docs/houdini/hom/hou/Volume.html).

Convert a volume into a 3D NumPy array:

```python
import numpy as np
node = hou.pwd()
geo = node.geometry()

# Each Prim resides inside a Geometry object and stores some
# sort of 3D geometric primitive, like a polygon, a NURBS curve,
# or a volume. In this case the primitive represents a volume.

# Get first volume
volume = geo.prims()[0]

# Get voxel values
voxel_vals = volume.allVoxels()
# Make a 1-dimensional numpy array from voxel values
np_volume = np.array(voxel_vals)

# Convert 1D array to 3D
vol_res = volume.resolution()

np_volume3d = np_volume.reshape(vol_res)
```

Note that this array data cannot be stored in geometry directly. After manipulating the array it should be converted back to attributes or saved somewhere.

## Convert a NumPy array to a picture

This code converts a 3D array to a flipbook sheet:

```python
# Calc 2d image size
import math
res_2d = int(math.sqrt(vol_res[0] * vol_res[1] * vol_res[2]))

# Create 2d image container
vol_2d = np.zeros((res_2d, res_2d))

# Fill container with sliced volume data
for i in range(int(res_2d/vol_res[0])):
    for j in range(int(res_2d/vol_res[1])):
        vol_2d[i*vol_res[0]:(i+1)*vol_res[0], j*vol_res[0]:(j+1)*vol_res[0]] = np_volume3d[:,:,(j+i)]

# Preview 2d Image
from PIL import Image
np_image = Image.fromarray((vol_2d*255).astype(np.uint8))
np_image.show()
```

![Sliced volume preview](/images/houdini_numpy/slices_volume_preview.jpg)

The `image.show()` method is for previewing. For saving to disk: `np_image.save("C:/Temp.../image.jpg")`.

## Convert a NumPy array to a Houdini volume

This code fills a NumPy array with random values and stores them in a volume:

```python
import numpy as np
node = hou.pwd()
geo = node.geometry()

# Get first volume
volume = geo.prims()[0]

# Get volume resolution
vol_res = volume.resolution()

# Create 3d volume with normal random values
np_volume3d = np.random.normal(0, 1, size=(100, 100, 100))

# Make it 1-dimensional. Houdini volumes use float32 and numpy
# float64, so the data needs to be converted.
np_volume = np_volume3d.flatten().astype(np.float32)

# Convert the NumPy array to a Python list
voxels = np_volume.tolist()

# Apply voxel data to geometry
volume.setAllVoxels(voxels)
```

![Array to volume](/images/houdini_numpy/array_to_volume.jpg)

Looks nice, but not very practical on its own. Since NumPy arrays are just a way of representing data — we can generate or feed any data we want!

## Houdini heightfields

Import multiple picture tiles and combine them into one piece. In Unreal Engine, for example, there is a way to export height data for each landscape chunk into `.png` files. With NumPy it is possible to grab this data (and even multiple landscape layers) and store it into one heightfield in one go.

Exported landscape data from Unreal usually looks like this:

![Exported landscape data](/images/houdini_numpy/exported_data.jpg)

This code looks into the given folder path and combines image tiles into one heightfield object according to Unreal's tile naming convention:

```python
from pathlib import Path
import imageio
import numpy as np

# Define variables
node = hou.pwd()
geo = node.geometry()
ls_data_dir = hou.parm("data_dir").eval()
tiles_x = hou.parm("ls_tiles1").eval()
tiles_y = hou.parm("ls_tiles2").eval()
ls_res_x = hou.parm("ls_res1").eval()
ls_res_y = hou.parm("ls_res2").eval()
chunk_res_x = int((ls_res_x - 1) / tiles_x)
chunk_res_y = int((ls_res_y - 1) / tiles_y)

# Height is always the first prim
heightfield_height = geo.prims()[0]
heightfield_resolution = heightfield_height.resolution()

# Create np array canvas to store image data
canvas2d = np.zeros((heightfield_resolution[0], heightfield_resolution[1]))

# Fill canvas2d with image data
for file in Path(ls_data_dir).iterdir():
    if not file.is_file():
        continue
    for x in range(tiles_x):
        for y in range(tiles_y):
            if f"x{x}_y{y}" in file.name:
                chunk_img = imageio.imread(file)
                if chunk_img is not None:
                    canvas2d[y*chunk_res_y:(y+1)*chunk_res_y,
                             x*chunk_res_x:(x+1)*chunk_res_x] = np.array(chunk_img)

# Map imported data to world coords (based on Unreal Engine documentation)
canvas2d = canvas2d/128 - 256

# Store data to heightfield
heightfield_height.setAllVoxels(tuple(np.transpose(canvas2d).flatten()))
```

![Landscape imported into Houdini](/images/houdini_numpy/landscape_to_houdini.jpg)

Despite being written in Python, it exhibits impressive speed — even when compared to VEX!

Transferring landscape data from Unreal to Houdini traditionally involves a time-consuming operation, often taking several seconds and requiring repetition whenever the landscape changes. This method allows for the selective export of only the essential chunks, significantly streamlining production time.

[NumPy Houdini examples (.hiplc)](https://github.com/AlekVolok/HoudiniExamples/blob/master/numpy_array.hiplc)

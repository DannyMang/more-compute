# %% [markdown]
# # MNIST with SciKit-Learn and skorch
#
# This notebooks shows how to define and train a simple Neural-Network with PyTorch and use it via skorch with SciKit-Learn.
#
# <table align="left"><td>
# <a target="_blank" href="https://colab.research.google.com/github/skorch-dev/skorch/blob/master/notebooks/MNIST.ipynb">
# <img src="https://www.tensorflow.org/images/colab_logo_32px.png" />Run in Google Colab</a>
# </td><td>
# <a target="_blank" href="https://github.com/skorch-dev/skorch/blob/master/notebooks/MNIST.ipynb"><img width=32px src="https://www.tensorflow.org/images/GitHub-Mark-32px.png" />View source on GitHub</a></td></table>

# %% [markdown]
# **Note**: If you are running this in [a colab notebook](https://colab.research.google.com/github/skorch-dev/skorch/blob/master/notebooks/MNIST.ipynb), we recommend you enable a free GPU by going:
#
# > **Runtime**   →   **Change runtime type**   →   **Hardware Accelerator: GPU**
#
# If you are running in colab, you should install the dependencies and download the dataset by running the following cell:

# %%
import subprocess

# Installation on Google Colab
try:
    import google.colab
    subprocess.run(['python', '-m', 'pip', 'install', 'skorch' , 'torch'])
except ImportError:
    pass

# %%
from sklearn.datasets import fetch_openml
from sklearn.model_selection import train_test_split
import numpy as np
import matplotlib.pyplot as plt

# %% [markdown]
# ## Loading Data
# Using SciKit-Learns ```fetch_openml``` to load MNIST data.

# %%
mnist = fetch_openml('mnist_784', as_frame=False, cache=False)

# %%
mnist.data.shape

# %% [markdown]
# ## Preprocessing Data
#
# Each image of the MNIST dataset is encoded in a 784 dimensional vector, representing a 28 x 28 pixel image. Each pixel has a value between 0 and 255, corresponding to the grey-value of a pixel.<br />
# The above ```featch_mldata``` method to load MNIST returns ```data``` and ```target``` as ```uint8``` which we convert to ```float32``` and ```int64``` respectively.

# %%
X = mnist.data.astype('float32')
y = mnist.target.astype('int64')

# %% [markdown]
# To avoid big weights that deal with the pixel values from between [0, 255], we scale `X` down. A commonly used range is [0, 1].

# %%
X /= 255.0

# %%
X.min(), X.max()

# %% [markdown]
# Note: data is not normalized.

# %%
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)

# %%
assert(X_train.shape[0] + X_test.shape[0] == mnist.data.shape[0])

# %%
X_train.shape, y_train.shape

# %% [markdown]
# ### Print a selection of training images and their labels

# %%
def plot_example(X, y):
    """Plot the first 5 images and their labels in a row."""
    for i, (img, y) in enumerate(zip(X[:5].reshape(5, 28, 28), y[:5])):
        plt.subplot(151 + i)
        plt.imshow(img)
        plt.xticks([])
        plt.yticks([])
        plt.title(y)

# %%
plot_example(X_train, y_train)

# %% [markdown]
# ## Build Neural Network with PyTorch
# Simple, fully connected neural network with one hidden layer. Input layer has 784 dimensions (28x28), hidden layer has 98 (= 784 / 8) and output layer 10 neurons, representing digits 0 - 9.

# %%
!pip install torch

# %%
import torch
from torch import nn
import torch.nn.functional as F

# %%
device = 'cuda' if torch.cuda.is_available() else 'cpu'

# %%
mnist_dim = X.shape[1]
hidden_dim = int(mnist_dim/8)
output_dim = len(np.unique(mnist.target))

# %%
mnist_dim, hidden_dim, output_dim

# %% [markdown]
# A Neural network in PyTorch's framework.

# %%
class ClassifierModule(nn.Module):
    def __init__(
            self,
            input_dim=mnist_dim,
            hidden_dim=hidden_dim,
            output_dim=output_dim,
            dropout=0.5,
    ):
        super(ClassifierModule, self).__init__()
        self.dropout = nn.Dropout(dropout)

        self.hidden = nn.Linear(input_dim, hidden_dim)
        self.output = nn.Linear(hidden_dim, output_dim)

    def forward(self, X, **kwargs):
        X = F.relu(self.hidden(X))
        X = self.dropout(X)
        X = F.softmax(self.output(X), dim=-1)
        return X

# %% [markdown]
# skorch allows to use PyTorch's networks in the SciKit-Learn setting:

# %%
!pip install skorch

# %%
from skorch import NeuralNetClassifier

# %%
torch.manual_seed(0)

net = NeuralNetClassifier(
    ClassifierModule,
    max_epochs=20,
    lr=0.1,
    device=device,
)

# %%
net.fit(X_train, y_train);

# %% [markdown]
# ## Prediction

# %%
from sklearn.metrics import accuracy_score

# %%
y_pred = net.predict(X_test)

# %%
accuracy_score(y_test, y_pred)

# %% [markdown]
# An accuracy of about 96% for a network with only one hidden layer is not too bad.
#
# Let's take a look at some predictions that went wrong:

# %%
error_mask = y_pred != y_test

# %%
plot_example(X_test[error_mask], y_pred[error_mask])

# %% [markdown]
# # Convolutional Network
# PyTorch expects a 4 dimensional tensor as input for its 2D convolution layer. The dimensions represent:
# * Batch size
# * Number of channel
# * Height
# * Width
#
# As initial batch size the number of examples needs to be provided. MNIST data has only one channel. As stated above, each MNIST vector represents a 28x28 pixel image. Hence, the resulting shape for PyTorch tensor needs to be (x, 1, 28, 28).

# %%
XCnn = X.reshape(-1, 1, 28, 28)

# %%
XCnn.shape

# %%
XCnn_train, XCnn_test, y_train, y_test = train_test_split(XCnn, y, test_size=0.25, random_state=42)

# %%
XCnn_train.shape, y_train.shape

# %%
class Cnn(nn.Module):
    def __init__(self, dropout=0.5):
        super(Cnn, self).__init__()
        self.conv1 = nn.Conv2d(1, 32, kernel_size=3)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3)
        self.conv2_drop = nn.Dropout2d(p=dropout)
        self.fc1 = nn.Linear(1600, 100) # 1600 = number channels * width * height
        self.fc2 = nn.Linear(100, 10)
        self.fc1_drop = nn.Dropout(p=dropout)

    def forward(self, x):
        x = torch.relu(F.max_pool2d(self.conv1(x), 2))
        x = torch.relu(F.max_pool2d(self.conv2_drop(self.conv2(x)), 2))

        # flatten over channel, height and width = 1600
        x = x.view(-1, x.size(1) * x.size(2) * x.size(3))

        x = torch.relu(self.fc1_drop(self.fc1(x)))
        x = torch.softmax(self.fc2(x), dim=-1)
        return x

# %%
torch.manual_seed(0)

cnn = NeuralNetClassifier(
    Cnn,
    max_epochs=10,
    lr=0.002,
    optimizer=torch.optim.Adam,
    device=device,
)

# %%
cnn.fit(XCnn_train, y_train);

# %%
y_pred_cnn = cnn.predict(XCnn_test)

# %%
accuracy_score(y_test, y_pred_cnn)

# %% [markdown]
# An accuracy of >98% should suffice for this example!
#
# Let's see how we fare on the examples that went wrong before:

# %%
accuracy_score(y_test[error_mask], y_pred_cnn[error_mask])

# %% [markdown]
# Over 70% of the previously misclassified images are now correctly identified.

# %%
plot_example(X_test[error_mask], y_pred_cnn[error_mask])
# %%
print("Hello from MoreCompute!")

# %%
import math
x = 42
print(f"The answer is {x}")

# %%
# Let's create a simple calculation
numbers = [1, 2, 3, 4, 5]
squared = [n**2 for n in numbers]
print(f"Numbers: {numbers}")
print(f"Squared: {squared}")

# %%
# Test some matplotlib if available
try:
    import matplotlib.pyplot as plt
    import numpy as np
    
    x = np.linspace(0, 10, 100)
    y = np.sin(x)
    
    plt.figure(figsize=(8, 4))
    plt.plot(x, y)
    plt.title("Sine Wave")
    plt.show()
except ImportError:
    print("Matplotlib not available, but that's okay!")

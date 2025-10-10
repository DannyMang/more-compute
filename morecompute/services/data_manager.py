import os
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .prime_intellect import PrimeIntellectService, CreateDiskRequest, DiskConfig, ProviderConfig, TeamConfig

class DatasetInfo:
    """
    container for dataset metadata
    """
    def __init__(self, name: str, size_gb: float | None = None, splits: dict | None = None, features: dict | None = None):
        self.name = name
        self.size_gb = size_gb
        self.splits = splits if splits is not None else {}
        self.features = features if features is not None else {}

class DataManager:
    """
    dataset manager

    integrates woth hugging face datasets amd prime intellect disk management
    """
    def __init__(
        self,
        cache_dir: str | Path | None = None,
        max_cache_size_gb: float = 50,
        prime_intellect: "PrimeIntellectService | None" = None
    ):
        """
        Initialize DataManager:

            args:
                cache_dir: directory for dataset cache (default: ~/.cache/huggingface/datasets)
                max_cache_size_gb: max cache size in GB
                prime_intellect: optional primeIntellectService for disk management
        """
        self.cache_dir = Path(cache_dir or Path.home() / ".cache" / "huggingface" / "datasets")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.max_cache_size_gb = max_cache_size_gb
        self.prime_intellect = prime_intellect

    def get_dataset_info(self, dataset_name: str, config: str | None = None) -> DatasetInfo:
        """
        get dataset metadata without downloading it

        args:
            dataset_name : huggingface dataset name
            config: optional dataset configuration

        returns:
            DatasetInfo with size, splits, features
        """
        try:
            from datasets import load_dataset_builder
            builder = load_dataset_builder(dataset_name, config)
            size_bytes = builder.info.dataset_size if builder.info.dataset_size else None
            size_gb = size_bytes / (1024**3) if size_bytes else None
            return DatasetInfo(
                name=dataset_name,
                size_gb=size_gb,
                splits=dict(builder.info.splits) if builder.info.splits  else{},
                features =dict(builder.info.features) if builder.info.features else {}
            )
        except Exception as e:
            #fallback to return unknown size
            return DatasetInfo(name=dataset_name)

    def check_environment(self) -> dict[str, object]:
        """
        a check for the current environment and available resources

        returns:
            dict with available_gb, is_remote, pod_id, cache_usage,gb
        """

        available_space = shutil.disk_usage(self.cache_dir).free / (1024**3)
        is_remote_pod = os.getenv('MC_POD_ID') is not None

        return {
            'available_gb': available_space,
            'is_remote': is_remote_pod,
            'pod_id': os.getenv('MC_POD_ID'),
            'cache_usage_gb': self.get_cache_size()
        }

    def get_cache_size(self) -> float:
        """
        get total cache in gb
        """
        try:
            total = 0
            for path in self.cache_dir.rglob('*'):
                if path.is_file():
                    total += path.stat().st_size
            return total / (1024**3)
        except Exception as e:
            return 0.0

    def list_cache_dataset(self) -> list[dict[str, object]]:
        """
        list of all cache
        """
        datasets = []
        try:
            for item in self.cache_dir.iterdir():
                if item.is_dir():
                    size = sum(f.stat().st_size for f in item.rglob('*') if f.is_file())
                    datasets.append({
                        'name': item.name,
                        'size_gb': size / (1024**3),
                        'path': str(item)
                    })
            return sorted(datasets, key=lambda x: x['size_gb'], reverse=True)  # type: ignore
        except Exception:
            return []

    def clear_cache(self, dataset_id: str | None = None) -> dict[str, str]:
        """
        clear specific dataset or entire cache

        args:
            dataset_id : (optional) dataset name to clear, if None then clear all

        returns:
            dict with status msg
        """

        try:
            if dataset_id:
                for item in self.cache_dir.iterdir():
                    if dataset_id in item.name:
                        if item.is_dir():
                            shutil.rmtree(item)
                        else:
                            item.unlink()
                return {"status": "ok", "message": f"Cleared {dataset_id}"}
            else:
                shutil.rmtree(self.cache_dir)  # clear entire cache
                self.cache_dir.mkdir(parents=True)
                return {"status": "ok", "message": "Cleared all cache"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # Core smart loading methods - TO BE IMPLEMENTED

    async def load_smart(
        self,
        dataset_name: str,
        config: str | None = None,
        split: str | None = None,
        auto_stream_threshold_gb: float = 10.0,
        **kwargs
    ) -> dict[str, object]:
        """
        Smart dataset loading with automatic streaming/downloading decisions.

        This is the method that decides what to do based on:
        - Dataset size (from metadata check)
        - Available disk space
        - Whether running on remote pod
        - User threshold preferences

        Args:
            dataset_name: HuggingFace dataset name (e.g., "openai/gsm8k")
            config: Optional dataset configuration
            split: Optional split to load
            auto_stream_threshold_gb: Auto-stream datasets larger than this (default: 10GB)
            **kwargs: Additional arguments for load_dataset

        Returns:
            Dict with:
                - action: "download" | "stream" | "disk_needed" | "recommend_stream"
                - recommendation: User-facing message explaining the decision
                - import_code: Python code snippet user can run
                - info: DatasetInfo object with metadata
                - alternatives: (optional) Dict of alternative approaches

        """
        info = self.get_dataset_info(dataset_name, config)
        size_gb = info.size_gb
        env = self.check_environment()
        available_gb = env['available_gb']
        is_remote = env['is_remote']
        config_str = f',"{config}"'if config else ''
        split_str = f',split="{split}"'if split else''

        #unknown size for whatever reason
        if size_gb is None:
            return {
                "action": "stream",
                "recommendation": "Dataset size unknown, streaming for safety",
                "import_code": f'from datasets import load_dataset\ndataset = load_dataset("{dataset_name}"{config_str}, streaming=True)',
                "info": info
            }

        #too big
        if size_gb > available_gb * 0.8:
            #if on remote pod w/ primte intellect, suggest disk
            if is_remote and self.prime_intellect:
                return await self._handle_remote_storage(dataset_name, size_gb, env['pod_id'])
            else:
                return {
                    "action": "stream",
                    "recommendation": f"Dataset ({size_gb:.1f}GB) too large for available space ({available_gb:.1f}GB). Auto-streaming.",
                    "import_code": f'from datasets import load_dataset\ndataset = load_dataset("{dataset_name}"{config_str}, streaming=True)',
                    "info": info
                }

        #large dataset, recommend streaming
        if size_gb > auto_stream_threshold_gb:
            return {
                "action": "recommend_stream",
                "recommendation": f"Large dataset ({size_gb:.1f}GB). Recommend streaming to save space.",
                "info": info,
                "alternatives": {
                "stream": f'load_dataset("{dataset_name}"{config_str}, streaming=True)',
                "download": f'load_dataset("{dataset_name}"{config_str})',
                "subset": f'load_dataset("{dataset_name}"{config_str}, split="train[:1000]")'
                }
            }

        #case 4 small enough to download
        return {
            "action": "download",
            "recommendation": f"Downloading {size_gb:.1f}GB to cache...",
            "import_code": f'from datasets import load_dataset\ndataset = load_dataset("{dataset_name}"{config_str}{split_str})',
            "info": info
        }


    async def _handle_remote_storage(
        self,
        dataset_name: str,
        size_gb: float,
        pod_id: str
    ) -> dict[str, object]:
        """
        Handle storage when dataset is too large for pod's default disk.

        Called by load_smart() when:
        1. Dataset won't fit on pod disk
        2. Running on remote pod (MC_POD_ID env var set)
        3. Prime Intellect service is configured

        Args:
            dataset_name: Dataset name
            size_gb: Dataset size in GB
            pod_id: Current pod ID from MC_POD_ID env var

        Returns:
            Dict with:
                - action: "disk_needed"
                - recommendation: Explanation of the problem
                - disk_size_gb: Recommended disk size (dataset size * 1.2)
                - pod_id: Pod to attach disk to
                - alternatives: Dict of other options (stream, subset)
                - estimated_cost: Monthly cost estimate
        """
        if not self.prime_intellect:
            return {
                "action": "stream",
                "recommendation": "Dataset too large, streaming recommended"
            }
        recommended_disk_size = int(size_gb * 1.2)
        estimated_cost_monthly = recommended_disk_size * 0.10

        return {
            "action": "disk_needed",
            "recommendation": f"Dataset ({size_gb:.1f}GB) requires external disk",
            "disk_size_gb": recommended_disk_size,
            "pod_id": pod_id,
            "alternatives": {
                "stream": "Stream the dataset (recommended for training)",
                "create_disk": f"Create {recommended_disk_size}GB disk and attach to pod",
                "subset": "Load subset for testing"
            },
            "estimated_cost": f"${estimated_cost_monthly:.2f}/month"
        }


    async def create_and_attach_disk(
        self,
        pod_id: str,
        disk_name: str,
        size_gb: int,
        provider_type: str = "runpod"
    ) -> dict[str, object]:
        """
        Create a disk via Prime Intellect API and attach it to a pod.

        Args:
            pod_id: Pod to attach disk to
            disk_name: Human-readable name for the disk
            size_gb: Disk size in GB
            provider_type: Cloud provider (default: "runpod")

        Returns:
            Dict with:
                - status: "ok" | "error"
                - disk_id: Created disk ID (if successful)
                - disk_name: Disk name
                - size_gb: Disk size
                - mount_path: Where disk will be mounted (e.g., /mnt/disks/disk-abc123)
                - message: Instructions for using the disk
                - error: Error message (if status == "error")
        """
        if not self.prime_intellect:
            return {"status": "error", "message": "Prime Intellect not configured"}

        try:
            from .prime_intellect import CreateDiskRequest, DiskConfig, ProviderConfig
            disk_config = DiskConfig(name=disk_name, size=size_gb)
            provider_config = ProviderConfig(type=provider_type)
            disk_request = CreateDiskRequest(disk=disk_config, provider=provider_config)
            disk_response = await self.prime_intellect.create_disks(disk_request)
            return {
                "status": "ok",
                "disk_id": disk_response.id,
                "disk_name": disk_response.name,
                "size_gb": disk_response.size,
                "mount_path": f"/mnt/disks/{disk_response.id}",
                "message": f"Disk created successfully. Use cache_dir='/mnt/disks/{disk_response.id}' when loading dataset"
            }

        except Exception as e:
            return {"status": "error", "message": str(e)}

    def to_pytorch_dataloader(self, dataset, batch_size: int = 32, **kwargs):
        """
        Convert HuggingFace dataset to PyTorch DataLoader.

        Convenience helper for training. Sets dataset format to 'torch'
        and wraps in DataLoader.

        Args:
            dataset: HuggingFace dataset
            batch_size: Batch size for training
            **kwargs: Additional DataLoader arguments (shuffle, num_workers, etc.)

        Returns:
            torch.utils.data.DataLoader
        """
        from torch.utils.data import DataLoader
        dataset.set_format("torch")
        return DataLoader(dataset, batch_size=batch_size, **kwargs)

    def load_subset(
        self,
        dataset_name: str,
        num_samples: int = 1000,
        split: str = "train",
        config: str | None = None
    ) -> dict[str, object]:
        """
        Generate code to load a small subset for testing/development.

        Args:
            dataset_name: HuggingFace dataset name
            num_samples: Number of samples to load
            split: Which split to use
            config: Optional dataset configuration

        Returns:
            Dict with:
                - action: "subset"
                - num_samples: Number of samples
                - import_code: Code to load the subset
                - recommendation: Explanation
        """
        config_str = f', "{config}"' if config else ''

        return {
            "action": "subset",
            "num_samples": num_samples,
            "import_code": f'from datasets import load_dataset\ndataset = load_dataset("{dataset_name}"{config_str}, split="{split}[:{num_samples}]")',
            "recommendation": f"Loading {num_samples} samples from {split} split for testing"
        }

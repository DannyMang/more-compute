
class DeviceMetrics:
    def get_all_devices(self):
        return {
            "cpu": self.get_cpu_metrics(),
            "memory": self.get_memory_metrics(),
            "gpu": self.get_gpu_metrics(),
            "storage": self.get_storage_metrics(),
            "network": self.get_network_metrics()
        }

    def get_cpu_metrics(self):
        #TO-DO
        pass

    def get_memory_metrics(self):
        #TO-DO
        pass

    def get_gpu_metrics(self):
        #TO-DO
        pass

    def get_storage_metrics(self):
        #TO-DO
        pass

    def get_network_metrics(self):
        #TO-DO
        pass

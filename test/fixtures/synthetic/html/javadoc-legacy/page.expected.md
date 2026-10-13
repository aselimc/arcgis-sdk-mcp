`com.example.harbor.server`

# Interface IBerthServer

- **All Superinterfaces:** java.io.Serializable

```java
public interface IBerthServer
extends java.io.Serializable
```

Gives access to the berths of a port.

### Method Summary

| Modifier and Type | Method and Description |
| --- | --- |
| `java.lang.String` | `getBerthName(int index)`<br>Name of the berth at an index. |
| `int` | `getBerthCount()`<br>**Deprecated.** Counts every call. |

### Method Detail

#### getBerthName

```java
java.lang.String getBerthName(int index)
                      throws java.io.IOException
```

Name of the berth at an index. The first berth has index 0.

- **Parameters:** `index` - The index (in)
- **Returns:** The berth name
- **Throws:**
  - `java.io.IOException` - If the port cannot be reached.
  - [`PortException`](https://docs.example.com/server/api/java/com/example/harbor/PortException.html) - If the index is out of range.

#### getBerthCount

```java
int getBerthCount()
```

**Deprecated.** Counts every call.

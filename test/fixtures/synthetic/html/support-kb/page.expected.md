- **Article ID:** 000990001
- **Type:** How To
- **Product:** Harbor Desk
- **First published:** 02/03/2025
- **Last published:** 01/05/2026

# Export gauge readings with a script

## Summary

The readings of one gauge can be written to a text file from the Python window.

## Procedure

1. Open the Python window.
2. Run the script below.

```python
import harbor
readings = harbor.gauges.read("N4")
harbor.export(readings, r"C:\temp\n4.txt")
```

**Check the result**

```python
print(open(r"C:\temp\n4.txt").read())
```

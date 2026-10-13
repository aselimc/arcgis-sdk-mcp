# Text functions

Functions for building and inspecting text values.

> **Caution:**
>
> Text positions start at zero.

- [Label profile](https://docs.example.com/quay/profiles/labels/): Expressions that build map labels.
- [Popup profile](https://docs.example.com/quay/profiles/popups/): Expressions shown when a feature is clicked.

## Join

#### Join(values, separator?) -> [Text](https://docs.example.com/quay/types/#text)

Glues the values together. A date is written with its offset, as in `-07:00`.

```quay
var parts = ["north", "pier"]
Join(parts, "-") // "north-pier"
```

---

## Count

#### Count(value) -> [Number](https://docs.example.com/quay/types/#number)

Returns the number of characters in a text value.

```quay
Count("quay") // 4
```
